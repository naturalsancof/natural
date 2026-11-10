import {useEffect, useRef, useState} from 'react';
import * as stylex from '@stylexjs/stylex';
import {AppShell} from '@astryxdesign/core/AppShell';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {Icon} from '@astryxdesign/core/Icon';
import {Layout, LayoutPanel} from '@astryxdesign/core/Layout';
import {NavIcon} from '@astryxdesign/core/NavIcon';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {Switch} from '@astryxdesign/core/Switch';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {TopNav, TopNavHeading, TopNavItem} from '@astryxdesign/core/TopNav';
import {VStack} from '@astryxdesign/core/VStack';
import {useTheme} from '@astryxdesign/core/theme';
import {GlobeAltIcon, PencilSquareIcon} from '@heroicons/react/24/outline';
import wallpaperDark from '../assets/wallpaper-dark.jpg';
import wallpaperLight from '../assets/wallpaper-light.jpg';
import {clusterNotes} from './lib/project.js';
import {useBoard} from './lib/useBoard.js';
import {ComposerDialog} from './components/ComposerDialog.jsx';
import {NoteCard} from './components/NoteCard.jsx';
import {PlaceDialog} from './components/PlaceDialog.jsx';
import {WorldMap} from './components/WorldMap.jsx';

const styles = stylex.create({
  contentMax: {
    maxWidth: 1100,
    marginInline: 'auto',
    width: '100%',
  },
  heroImage: {
    width: '100%',
    height: 'auto',
    display: 'block',
  },
  stickyMap: {
    position: 'sticky',
    top: 'var(--spacing-4)',
  },
});

function useWide() {
  const query = '(min-width: 960px)';
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setWide(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return wide;
}

function AdminDialog({isOpen, onOpenChange, user, onSignIn, onSignOut}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);

  async function submit() {
    if (!email.trim() || !password) {
      setMessage('请输入邮箱和密码。');
      return;
    }
    setPending(true);
    setMessage('正在登录…');
    try {
      await onSignIn(email.trim(), password);
      setPassword('');
      setMessage('');
      onOpenChange(false);
    } catch (error) {
      console.error('管理员登录失败:', error);
      setMessage('登录失败，请检查邮箱和密码。');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={440}>
      <VStack gap={3}>
        <DialogHeader
          title={user ? '管理员' : '管理员登录'}
          subtitle={user ? `已登录：${user.email}` : '登录后可以管理留言。'}
          onOpenChange={onOpenChange}
        />
        {user ? (
          <Button
            label="退出登录"
            variant="secondary"
            onClick={async () => {
              try {
                await onSignOut();
                onOpenChange(false);
              } catch (error) {
                console.error('退出登录失败:', error);
                setMessage('退出失败，请稍后再试。');
              }
            }}
          />
        ) : (
          <VStack gap={3}>
            <TextInput
              label="邮箱"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="username"
              placeholder="管理员邮箱"
              hasAutoFocus
            />
            <TextInput
              label="密码"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              placeholder="管理员密码"
              onEnter={submit}
            />
            {message ? <Text type="supporting">{message}</Text> : null}
            <Button label="登录" variant="primary" onClick={submit} isLoading={pending} />
          </VStack>
        )}
      </VStack>
    </Dialog>
  );
}

export default function App({onModeChange}) {
  const {mode} = useTheme();
  const wide = useWide();
  const board = useBoard();
  const [pane, setPane] = useState('notes');
  const [composerOpen, setComposerOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [placeNote, setPlaceNote] = useState(null);
  const [zoomed, setZoomed] = useState(false);
  const [activeNoteId, setActiveNoteId] = useState(null);
  const mapRef = useRef(null);
  const dark = mode === 'dark';
  const print = dark
    ? {src: wallpaperDark, alt: '川瀬巴水《牛堀の夕》', width: 2233, height: 1256}
    : {src: wallpaperLight, alt: '川瀬巴水《鳴沢の富士》', width: 3200, height: 2114};

  useEffect(() => {
    const nodes = [...document.querySelectorAll('[id^="note-"]')];
    const visible = new Set();
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const id = entry.target.id.slice('note-'.length);
        if (entry.isIntersecting) {
          visible.add(id);
        } else {
          visible.delete(id);
        }
      });
      const first = nodes.find(node => visible.has(node.id.slice('note-'.length)));
      setActiveNoteId(first ? first.id.slice('note-'.length) : null);
    }, {rootMargin: '-15% 0px -55% 0px'});

    nodes.forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, [board.feed]);

  const notesList = (
    <VStack gap={3}>
      <HStack justify="between" vAlign="center">
        <Heading id="notes" level={2}>旅行足迹</Heading>
        {board.status === 'error' ? (
          <Button label="重新加载" variant="ghost" onClick={board.reload} />
        ) : null}
      </HStack>
      {board.status === 'loading' ? (
        <VStack gap={3}>
          {[0, 1, 2].map(index => (
            <Skeleton key={index} width="100%" height={120} index={index} />
          ))}
        </VStack>
      ) : null}
      {board.status === 'error' ? (
        <EmptyState
          title="无法加载留言"
          description="请检查网络连接后再试。"
          headingLevel={3}
          actions={<Button label="重新加载" variant="secondary" onClick={board.reload} />}
        />
      ) : null}
      {board.status === 'empty' ? (
        <EmptyState
          title="还没有留言"
          description="成为第一个留下足迹的人吧。"
          headingLevel={3}
          actions={<Button label="写一则旅途留言" variant="primary" onClick={() => setComposerOpen(true)} />}
        />
      ) : null}
      {board.feed.map(item => {
        if (item.type === 'gap') {
          return (
            <Card key="gap" variant="muted">
              <VStack gap={2}>
                <Text type="body">这里和下面的帖子之间，还有没加载出来的内容</Text>
                <Button
                  label="加载中间被跳过的帖子"
                  variant="secondary"
                  onClick={board.loadNextPage}
                  isLoading={board.loadingMore}
                />
              </VStack>
            </Card>
          );
        }

        const note = item.note;
        return (
          <NoteCard
            key={item.key}
            note={note}
            comments={board.comments.get(note.id) || board.comments.get(Number(note.id)) || []}
            isAdmin={!!board.user}
            flash={String(board.flashId) === String(note.id)}
            onEditPlace={() => setPlaceNote(note)}
            onDelete={board.removeNoteRemote}
            onComment={board.publishComment}
            onDeleteComment={board.removeComment}
          />
        );
      })}
      <Text id="notes-sentinel" type="supporting">
        {board.loadingMore ? '正在加载更多…' : ' '}
      </Text>
    </VStack>
  );

  const mapPane = (
    <VStack gap={2} xstyle={styles.stickyMap}>
      <HStack justify="between" vAlign="center">
        <Heading id="map" level={2}>足迹地图</Heading>
        <Button
          label="全览"
          variant="ghost"
          isDisabled={!zoomed}
          onClick={() => mapRef.current?.resetView()}
        />
      </HStack>
      <WorldMap
        mapRef={mapRef}
        label="足迹地图"
        pins={clusterNotes(board.places)}
        activeNoteId={activeNoteId}
        onZoomedChange={setZoomed}
        onSelectNote={id => {
          setPane('notes');
          board.focusNote(id);
        }}
      />
      {board.places.length ? null : (
        <Text type="supporting">
          还没有带地点的留言，发帖时标一个位置就会出现在地图上。
        </Text>
      )}
    </VStack>
  );

  return (
    <AppShell
      variant="surface"
      contentPadding={6}
      topNav={
        <TopNav
          label="Bon voyage"
          heading={
            <TopNavHeading
              heading="Bon voyage"
              headingHref="#top"
              logo={<NavIcon icon={<Icon icon={GlobeAltIcon} size="sm" />} />}
            />
          }
          centerContent={
            <>
              <TopNavItem label="旅行足迹" href="#notes" />
              <TopNavItem label="足迹地图" href="#map" />
            </>
          }
          endContent={
            <>
              <Switch
                label="深色"
                value={dark}
                onChange={checked => onModeChange(checked ? 'dark' : 'light')}
                labelPosition="start"
              />
              <Button
                label={board.user ? '管理员' : '管理员登录'}
                variant="ghost"
                onClick={() => setAdminOpen(true)}
              />
              <Button
                label="写留言"
                variant="primary"
                icon={<Icon icon={PencilSquareIcon} size="sm" />}
                onClick={() => setComposerOpen(true)}
              />
            </>
          }
        />
      }
    >
      <VStack id="top" gap={10} xstyle={styles.contentMax}>
        <VStack gap={4}>
          <Heading level={1} type="display-2">Bon voyage</Heading>
          <Text type="large">留下此刻，带走回忆。</Text>
          <Card padding={0} variant="muted">
            <img
              {...stylex.props(styles.heroImage)}
              src={print.src}
              alt={print.alt}
              width={print.width}
              height={print.height}
            />
          </Card>
          <HStack gap={2}>
            <Button
              label="写一则旅途留言"
              variant="primary"
              onClick={() => setComposerOpen(true)}
            />
          </HStack>
        </VStack>

        {wide ? (
          <Layout
            height="auto"
            content={notesList}
            end={
              <LayoutPanel label="足迹地图" width={360}>
                {mapPane}
              </LayoutPanel>
            }
          />
        ) : (
          <VStack gap={4}>
            <SegmentedControl label="浏览" value={pane} onChange={setPane} layout="fill">
              <SegmentedControlItem value="notes" label="旅行足迹" />
              <SegmentedControlItem value="map" label="足迹地图" />
            </SegmentedControl>
            {pane === 'map' ? mapPane : notesList}
          </VStack>
        )}

        <Text type="supporting">背景 川瀬巴水《鳴沢の富士》《牛堀の夕》</Text>
      </VStack>

      <ComposerDialog
        isOpen={composerOpen}
        onOpenChange={setComposerOpen}
        onPublish={board.publishNote}
        validateImage={board.validateImage}
      />
      <AdminDialog
        isOpen={adminOpen}
        onOpenChange={setAdminOpen}
        user={board.user}
        onSignIn={board.signIn}
        onSignOut={board.signOut}
      />
      <PlaceDialog
        isOpen={!!placeNote}
        initial={placeNote ? {
          location: placeNote.location || '',
          lat: placeNote.lat,
          lng: placeNote.lng,
        } : null}
        onOpenChange={open => {
          if (!open) {
            setPlaceNote(null);
          }
        }}
        onConfirm={async result => {
          const note = placeNote;
          setPlaceNote(null);
          if (!note || !result) {
            return;
          }
          const patch = result.clear
            ? {location: null, lat: null, lng: null}
            : {location: result.location, lat: result.lat, lng: result.lng};
          try {
            await board.saveLocation(note, patch);
          } catch (error) {
            console.error('更新地点失败:', error);
            window.alert(error.message || '更新地点失败，请稍后再试。');
          }
        }}
      />
    </AppShell>
  );
}
