import {useState} from 'react';
import * as stylex from '@stylexjs/stylex';
import {AlertDialog} from '@astryxdesign/core/AlertDialog';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Collapsible} from '@astryxdesign/core/Collapsible';
import {HStack} from '@astryxdesign/core/HStack';
import {Text} from '@astryxdesign/core/Text';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Timestamp} from '@astryxdesign/core/Timestamp';
import {VStack} from '@astryxdesign/core/VStack';
import {useLightbox} from '@astryxdesign/core/Lightbox';
import {colorVars} from '@astryxdesign/core/theme/tokens.stylex';

const styles = stylex.create({
  photo: {
    width: '100%',
    height: 'auto',
    display: 'block',
    cursor: 'pointer',
  },
  flash: {
    backgroundColor: colorVars['--color-accent-muted'],
  },
});

export function NoteCard({
  note,
  comments,
  isAdmin,
  flash,
  onEditPlace,
  onDelete,
  onComment,
  onDeleteComment,
}) {
  const [writing, setWriting] = useState(false);
  const [author, setAuthor] = useState('');
  const [content, setContent] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [confirmNote, setConfirmNote] = useState(false);
  const [confirmComment, setConfirmComment] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const items = comments || [];
  const hasPoint = Number.isFinite(note.lat) && Number.isFinite(note.lng);
  const lightbox = useLightbox({
    media: note.img_url ? [{
      src: note.img_url,
      alt: `${note.author || '匿名'}的照片`,
    }] : [],
    hasZoom: true,
  });

  async function submitComment() {
    const name = author.trim();
    const text = content.trim();

    if (!name) {
      setMessage('请输入昵称。');
      return;
    }
    if (name.length > 60) {
      setMessage('昵称不能超过 60 个字符。');
      return;
    }
    if (!text) {
      setMessage('写点什么再发表吧。');
      return;
    }
    if (text.length > 1000) {
      setMessage('评论不能超过 1000 个字符。');
      return;
    }

    setPending(true);
    setMessage('正在发表…');
    try {
      await onComment(note.id, name, text);
      setContent('');
      setMessage('评论已发表。');
    } catch (error) {
      console.error('发表评论失败:', error);
      setMessage(error.message || '评论发表失败，请稍后再试。');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card id={`note-${note.id}`} xstyle={flash ? styles.flash : undefined}>
      <VStack gap={2}>
        <HStack gap={2} justify="between" vAlign="center">
          <Text type="label">{note.author || '匿名'}</Text>
          <Timestamp value={note.created_at} format="auto" type="supporting" isLive />
        </HStack>
        {note.content ? <Text type="body">{note.content}</Text> : null}
        <HStack>
          <Button
            label={note.location && hasPoint ? note.location : '添加地点'}
            variant="ghost"
            onClick={onEditPlace}
          />
        </HStack>
        {note.img_url ? (
          <img
            {...stylex.props(styles.photo)}
            {...lightbox.triggerProps}
            src={note.img_url}
            alt={`${note.author || '匿名'}附带的照片`}
          />
        ) : null}
        {lightbox.element}
        {items.length ? (
          <Collapsible
            defaultIsOpen={false}
            trigger={<Text type="supporting">{items.length} 条评论</Text>}
          >
            <VStack gap={2}>
              {items.map(comment => (
                <VStack key={comment.id} gap={1}>
                  <HStack gap={2} justify="between" vAlign="center">
                    <Text type="label">{comment.author || '匿名'}</Text>
                    <Timestamp value={comment.created_at} format="relative" type="supporting" />
                  </HStack>
                  <Text type="body">{comment.content}</Text>
                  {isAdmin ? (
                    <Button
                      label="删除评论"
                      variant="ghost"
                      onClick={() => setConfirmComment(comment)}
                    />
                  ) : null}
                </VStack>
              ))}
            </VStack>
          </Collapsible>
        ) : null}
        {writing ? (
          <VStack gap={2}>
            <TextInput
              label="昵称"
              value={author}
              onChange={setAuthor}
              isRequired
              placeholder="昵称"
            />
            <TextArea
              label="评论"
              value={content}
              onChange={setContent}
              rows={2}
              maxLength={1000}
              placeholder="写下你的评论…"
              isRequired
            />
            {message ? <Text type="supporting">{message}</Text> : null}
            <HStack gap={2} justify="end">
              <Button label="取消" variant="ghost" onClick={() => setWriting(false)} />
              <Button label="发表评论" variant="primary" onClick={submitComment} isLoading={pending} />
            </HStack>
          </VStack>
        ) : (
          <Button label="写评论" variant="secondary" onClick={() => setWriting(true)} />
        )}
        {isAdmin ? (
          <Button label="删除留言" variant="destructive" onClick={() => setConfirmNote(true)} />
        ) : null}
      </VStack>
      <AlertDialog
        isOpen={confirmNote}
        onOpenChange={setConfirmNote}
        title="删除这条留言？"
        description={`确定删除「${note.author || '匿名'}」的这条留言吗？删除后无法恢复。`}
        actionLabel="删除留言"
        actionVariant="destructive"
        cancelLabel="取消"
        isActionLoading={deleting}
        onAction={async () => {
          setDeleting(true);
          try {
            await onDelete(note);
            setConfirmNote(false);
          } finally {
            setDeleting(false);
          }
        }}
      />
      <AlertDialog
        isOpen={!!confirmComment}
        onOpenChange={open => {
          if (!open) {
            setConfirmComment(null);
          }
        }}
        title="删除这条评论？"
        description={`确定删除「${confirmComment?.author || '匿名'}」的这条评论吗？删除后无法恢复。`}
        actionLabel="删除评论"
        actionVariant="destructive"
        cancelLabel="取消"
        isActionLoading={deleting}
        onAction={async () => {
          setDeleting(true);
          try {
            await onDeleteComment(note.id, confirmComment);
            setConfirmComment(null);
          } finally {
            setDeleting(false);
          }
        }}
      />
    </Card>
  );
}
