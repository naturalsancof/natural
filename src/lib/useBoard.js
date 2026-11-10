import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useToast} from '@astryxdesign/core/Toast';
import {getSupabaseClient} from './supabase.js';
import {
  createComment,
  createNote,
  deleteComment,
  deleteNote,
  fetchComments,
  fetchCommentsForNote,
  fetchNoteById,
  fetchNotes,
  fetchPlaces,
  subscribeToComments,
  subscribeToNotes,
  updateNoteLocation,
} from './notes.js';
import {compressImage, uploadImage, validateImage} from './storage.js';

const PAGE_SIZE = 10;

function timeOf(note) {
  return new Date(note.created_at).getTime();
}

function sameId(a, b) {
  return String(a) === String(b);
}

export function buildFeed(notes, extras, tail) {
  const oldest = notes[notes.length - 1];
  const oldestTime = oldest ? timeOf(oldest) : null;
  const extraList = extras
    .filter(item => oldestTime === null || timeOf(item) < oldestTime)
    .sort((a, b) => timeOf(b) - timeOf(a));

  const items = notes.map(note => ({type: 'note', note, key: `note-${note.id}`}));

  if (extraList.length) {
    extraList.slice(0, -1).forEach(note => {
      items.push({type: 'note', note, key: `extra-${note.id}`});
    });
    items.push({type: 'gap', key: 'gap'});
    const oldestExtra = extraList[extraList.length - 1];
    items.push({type: 'note', note: oldestExtra, key: `extra-${oldestExtra.id}`});
  }

  tail.forEach(note => {
    items.push({type: 'note', note, key: `tail-${note.id}`});
  });

  return items;
}

export function useBoard() {
  const {showToast} = useToast();
  const client = useMemo(() => getSupabaseClient(), []);

  const [notes, setNotes] = useState([]);
  const [extras, setExtras] = useState([]);
  const [tail, setTail] = useState([]);
  const [comments, setComments] = useState(() => new Map());
  const [places, setPlaces] = useState([]);
  const [status, setStatus] = useState('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [user, setUser] = useState(null);
  const [flashId, setFlashId] = useState(null);

  const notesRef = useRef([]);
  const extrasRef = useRef([]);
  const tailRef = useRef([]);
  const commentsRef = useRef(new Map());
  const hasMoreRef = useRef(true);
  const hasMoreTailRef = useRef(true);
  const tailModeRef = useRef(false);
  const tailCursorRef = useRef(null);
  const loadingRef = useRef(false);
  const pausedRef = useRef(false);
  const flashTimer = useRef(0);

  const commitNotes = useCallback(next => {
    notesRef.current = next;
    setNotes(next);
  }, []);

  const commitExtras = useCallback(next => {
    extrasRef.current = next;
    setExtras(next);
  }, []);

  const commitTail = useCallback(next => {
    tailRef.current = next;
    setTail(next);
  }, []);

  const mergeCommentLists = useCallback(rows => {
    const next = new Map(commentsRef.current);

    rows.forEach(comment => {
      const key = comment.note_id;
      const bucket = next.get(key) || [];
      if (!bucket.some(item => sameId(item.id, comment.id))) {
        next.set(key, [...bucket, comment]);
      }
    });

    commentsRef.current = next;
    setComments(next);
  }, []);

  const replaceComments = useCallback((noteId, list) => {
    const next = new Map(commentsRef.current);
    next.set(noteId, list);
    commentsRef.current = next;
    setComments(next);
  }, []);

  const known = useCallback(id => {
    return (
      notesRef.current.some(item => sameId(item.id, id)) ||
      extrasRef.current.some(item => sameId(item.id, id)) ||
      tailRef.current.some(item => sameId(item.id, id))
    );
  }, []);

  const refreshPlaces = useCallback(async () => {
    try {
      const rows = await fetchPlaces(client);
      setPlaces(rows);
    } catch (error) {
      console.error('加载地图坐标失败:', error);
    }
  }, [client]);

  const loadComments = useCallback(async ids => {
    try {
      const rows = await fetchComments(client, ids);
      mergeCommentLists(rows);
    } catch (error) {
      console.error('加载评论失败:', error);
    }
  }, [client, mergeCommentLists]);

  const pruneExtras = useCallback(list => {
    const oldest = list[list.length - 1];
    if (!oldest) {
      return;
    }
    const oldestTime = timeOf(oldest);
    const next = extrasRef.current.filter(item => timeOf(item) < oldestTime);
    if (next.length !== extrasRef.current.length) {
      commitExtras(next);
    }
  }, [commitExtras]);

  const loadNextPage = useCallback(async () => {
    if (loadingRef.current || !hasMoreRef.current) {
      return;
    }

    loadingRef.current = true;
    setLoadingMore(true);

    try {
      const before = notesRef.current[notesRef.current.length - 1] || null;
      const page = await fetchNotes(client, {limit: PAGE_SIZE, before});

      if (!page.length) {
        hasMoreRef.current = false;
        setHasMore(false);
        if (!notesRef.current.length) {
          setStatus('empty');
        }
        return;
      }

      await loadComments(page.map(note => note.id));

      const next = [...notesRef.current];
      page.forEach(note => {
        if (!next.some(item => sameId(item.id, note.id))) {
          next.push(note);
        }
      });

      commitNotes(next);
      pruneExtras(next);
      hasMoreRef.current = page.length === PAGE_SIZE;
      setHasMore(hasMoreRef.current);
      setStatus('ready');
      refreshPlaces();
    } catch (error) {
      console.error('加载留言失败:', error);
      if (!notesRef.current.length) {
        setStatus('error');
      } else {
        showToast({body: '加载失败，请稍后再试', type: 'error'});
      }
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [client, commitNotes, loadComments, pruneExtras, refreshPlaces, showToast]);

  const loadTailPage = useCallback(async () => {
    if (loadingRef.current || !hasMoreTailRef.current || !tailCursorRef.current) {
      return;
    }

    loadingRef.current = true;
    setLoadingMore(true);

    try {
      const page = await fetchNotes(client, {
        limit: PAGE_SIZE,
        before: tailCursorRef.current,
      });

      if (!page.length) {
        hasMoreTailRef.current = false;
        return;
      }

      await loadComments(page.map(note => note.id));

      const next = [...tailRef.current];
      page.forEach(note => {
        if (!known(note.id)) {
          next.push(note);
        }
      });

      commitTail(next);
      tailCursorRef.current = page[page.length - 1];
      hasMoreTailRef.current = page.length === PAGE_SIZE;
      setStatus('ready');
    } catch (error) {
      console.error('加载留言失败:', error);
      showToast({body: '加载失败，请稍后再试', type: 'error'});
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [client, commitTail, known, loadComments, showToast]);

  const maybeAutoLoad = useCallback(() => {
    if (pausedRef.current || loadingRef.current) {
      return;
    }

    const sentinel = document.getElementById('notes-sentinel');
    if (!sentinel) {
      return;
    }

    const rect = sentinel.getBoundingClientRect();
    if (rect.top > window.innerHeight + 700) {
      return;
    }

    if (tailModeRef.current) {
      if (hasMoreTailRef.current) {
        loadTailPage();
      }
      return;
    }

    if (hasMoreRef.current) {
      loadNextPage();
    }
  }, [loadNextPage, loadTailPage]);

  const reload = useCallback(async () => {
    commitNotes([]);
    commitExtras([]);
    commitTail([]);
    commentsRef.current = new Map();
    setComments(new Map());
    hasMoreRef.current = true;
    setHasMore(true);
    hasMoreTailRef.current = true;
    tailModeRef.current = false;
    tailCursorRef.current = null;
    setStatus('loading');
    await loadNextPage();
  }, [commitExtras, commitNotes, commitTail, loadNextPage]);

  const prependNote = useCallback(note => {
    if (!note || note.id === undefined || note.id === null || known(note.id)) {
      return;
    }

    commitNotes([note, ...notesRef.current]);
    setStatus('ready');
    refreshPlaces();
  }, [commitNotes, known, refreshPlaces]);

  const removeNote = useCallback(id => {
    commitNotes(notesRef.current.filter(item => !sameId(item.id, id)));
    commitExtras(extrasRef.current.filter(item => !sameId(item.id, id)));
    const nextTail = tailRef.current.filter(item => !sameId(item.id, id));
    commitTail(nextTail);

    if (tailCursorRef.current && sameId(tailCursorRef.current.id, id)) {
      tailCursorRef.current = nextTail[nextTail.length - 1] || null;
    }

    const nextComments = new Map(commentsRef.current);
    nextComments.delete(id);
    commentsRef.current = nextComments;
    setComments(nextComments);

    if (!notesRef.current.length && !extrasRef.current.length && !tailRef.current.length) {
      if (hasMoreRef.current) {
        loadNextPage();
      } else {
        setStatus('empty');
      }
    }

    refreshPlaces();
  }, [commitExtras, commitNotes, commitTail, loadNextPage, refreshPlaces]);

  const patchNote = useCallback((noteId, patch) => {
    const apply = list => list.map(item => (
      sameId(item.id, noteId) ? {...item, ...patch} : item
    ));
    commitNotes(apply(notesRef.current));
    commitExtras(apply(extrasRef.current));
    commitTail(apply(tailRef.current));
    refreshPlaces();
  }, [commitExtras, commitNotes, commitTail, refreshPlaces]);

  const insertInOrder = useCallback(note => {
    if (!note || known(note.id)) {
      return;
    }

    const oldest = notesRef.current[notesRef.current.length - 1];
    const noteTime = timeOf(note);

    if (!oldest || noteTime >= timeOf(oldest)) {
      const next = [...notesRef.current];
      const index = next.findIndex(item => timeOf(item) < noteTime);
      if (index === -1) {
        next.push(note);
      } else {
        next.splice(index, 0, note);
      }
      commitNotes(next);
      return;
    }

    const nextExtras = [...extrasRef.current, note].sort((a, b) => timeOf(b) - timeOf(a));
    commitExtras(nextExtras);
    tailModeRef.current = true;
    tailCursorRef.current = note;
    hasMoreTailRef.current = true;
    setStatus('ready');
  }, [commitExtras, commitNotes, known]);

  const focusNote = useCallback(async noteId => {
    let note = [...notesRef.current, ...extrasRef.current, ...tailRef.current]
      .find(item => sameId(item.id, noteId));

    if (!note) {
      try {
        note = await fetchNoteById(client, noteId);
      } catch (error) {
        console.error('定位留言失败:', error);
        showToast({body: '这条留言暂时打不开', type: 'error'});
        return;
      }

      if (!note) {
        return;
      }

      insertInOrder(note);
      loadComments([note.id]);
    }

    pausedRef.current = true;
    setFlashId(note.id);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashId(null), 1800);

    window.requestAnimationFrame(() => {
      document.getElementById(`note-${note.id}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    });
  }, [client, insertInOrder, loadComments, showToast]);

  const publishNote = useCallback(async ({author, content, file, place}) => {
    let imageUrl = '';

    if (file) {
      const prepared = await compressImage(file);
      imageUrl = await uploadImage(client, prepared);
    }

    const created = await createNote(client, {
      author,
      content,
      img_url: imageUrl,
      location: place?.location || null,
      lat: place?.lat ?? null,
      lng: place?.lng ?? null,
    });

    if (created) {
      prependNote(created);
    }

    showToast({body: '发布成功'});
    return created;
  }, [client, prependNote, showToast]);

  const publishComment = useCallback(async (noteId, author, content) => {
    const created = await createComment(client, {
      note_id: noteId,
      author,
      content,
    });
    const list = commentsRef.current.get(noteId) || [];
    replaceComments(noteId, [...list, created]);
    return created;
  }, [client, replaceComments]);

  const removeComment = useCallback(async (noteId, comment) => {
    await deleteComment(client, comment.id);
    const list = (commentsRef.current.get(noteId) || [])
      .filter(item => !sameId(item.id, comment.id));
    replaceComments(noteId, list);
    showToast({body: '评论已删除'});
  }, [client, replaceComments, showToast]);

  const removeNoteRemote = useCallback(async note => {
    await deleteNote(client, note);
    removeNote(note.id);
    showToast({body: '留言已删除'});
  }, [client, removeNote, showToast]);

  const saveLocation = useCallback(async (note, patch) => {
    await updateNoteLocation(client, note.id, patch);
    patchNote(note.id, patch);
    showToast({body: patch.location ? '地点已更新' : '地点已移除'});
  }, [client, patchNote, showToast]);

  const signIn = useCallback(async (email, password) => {
    const {data, error} = await client.auth.signInWithPassword({email, password});
    if (error) {
      throw error;
    }
    setUser(data.user || null);
    showToast({body: '已登录管理员'});
  }, [client, showToast]);

  const signOut = useCallback(async () => {
    const {error} = await client.auth.signOut();
    if (error) {
      throw error;
    }
    setUser(null);
    showToast({body: '已退出登录'});
  }, [client, showToast]);

  useEffect(() => {
    let ignore = false;

    client.auth.getUser().then(({data}) => {
      if (!ignore) {
        setUser(data.user || null);
      }
    });

    const {data: subscription} = client.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });

    return () => {
      ignore = true;
      subscription.subscription.unsubscribe();
    };
  }, [client]);

  useEffect(() => {
    loadNextPage();
    // The first page loads once. Later pages come from the sentinel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const notesChannel = subscribeToNotes(client, payload => {
      if (payload?.eventType === 'INSERT') {
        prependNote(payload.new);
        return;
      }

      if (payload?.eventType === 'DELETE' && payload.old?.id != null) {
        removeNote(payload.old.id);
      }
    });

    const commentsChannel = subscribeToComments(client, payload => {
      const noteId = payload?.new?.note_id ?? payload?.old?.note_id;
      if (noteId == null || !known(noteId)) {
        return;
      }

      fetchCommentsForNote(client, noteId)
        .then(list => replaceComments(noteId, list))
        .catch(error => console.error('刷新评论失败:', error));
    });

    return () => {
      client.removeChannel(notesChannel);
      client.removeChannel(commentsChannel);
    };
  }, [client, known, prependNote, removeNote, replaceComments]);

  useEffect(() => {
    const resume = () => {
      pausedRef.current = false;
      maybeAutoLoad();
    };

    const types = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
    types.forEach(type => window.addEventListener(type, resume, {passive: true}));

    let frame = 0;
    const onScroll = () => {
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        maybeAutoLoad();
      });
    };

    window.addEventListener('scroll', onScroll, {passive: true});

    return () => {
      types.forEach(type => window.removeEventListener(type, resume));
      window.removeEventListener('scroll', onScroll);
      window.cancelAnimationFrame(frame);
    };
  }, [maybeAutoLoad]);

  const feed = useMemo(
    () => buildFeed(notes, extras, tail),
    [notes, extras, tail],
  );

  return {
    feed,
    comments,
    places,
    status,
    loadingMore,
    hasMore,
    user,
    flashId,
    validateImage,
    reload,
    loadNextPage,
    focusNote,
    publishNote,
    publishComment,
    removeComment,
    removeNoteRemote,
    saveLocation,
    signIn,
    signOut,
  };
}
