import {useEffect, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {FileInput} from '@astryxdesign/core/FileInput';
import {HStack} from '@astryxdesign/core/HStack';
import {Text} from '@astryxdesign/core/Text';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';
import {VStack} from '@astryxdesign/core/VStack';
import * as stylex from '@stylexjs/stylex';
import {PlaceDialog} from './PlaceDialog.jsx';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const styles = stylex.create({
  preview: {
    width: '100%',
    height: 'auto',
    maxHeight: '16vh',
    objectFit: 'contain',
    display: 'block',
  },
});

export function ComposerDialog({isOpen, onOpenChange, onPublish, validateImage}) {
  const [author, setAuthor] = useState('');
  const [content, setContent] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [place, setPlace] = useState(null);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!file) {
      setPreview('');
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!isOpen) {
      setAuthor('');
      setContent('');
      setFile(null);
      setPlace(null);
      setMessage('');
      setPending(false);
      setPlaceOpen(false);
    }
  }, [isOpen]);

  async function submit() {
    const name = author.trim();
    const text = content.trim();

    if (!name) {
      setMessage('请输入昵称。');
      return;
    }
    if (!text && !file) {
      setMessage('请输入文字或选择一张图片。');
      return;
    }
    if (name.length > 60) {
      setMessage('昵称不能超过 60 个字符。');
      return;
    }
    if (text.length > 2000) {
      setMessage('留言不能超过 2000 个字符。');
      return;
    }
    if (file) {
      const validation = validateImage(file);
      if (!validation.valid) {
        setMessage(validation.message);
        return;
      }
    }

    setPending(true);
    setMessage(file ? '正在处理照片…' : '正在发布…');

    try {
      await onPublish({author: name, content: text, file, place});
      onOpenChange(false);
    } catch (error) {
      console.error('发布留言失败:', error);
      setMessage(error.message || '发布失败，请稍后再试。');
      setPending(false);
    }
  }

  return (
    <>
      <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={560}>
        <VStack gap={3}>
          <DialogHeader
            title="写一则旅途留言"
            subtitle="留下此刻，带走回忆。"
            onOpenChange={onOpenChange}
            endContent={
              <Button
                label="发布留言"
                variant="primary"
                onClick={submit}
                isLoading={pending}
              />
            }
          />
          <TextInput
            label="昵称"
            value={author}
            onChange={setAuthor}
            isRequired
            autoComplete="nickname"
            placeholder="例如：小林"
            hasAutoFocus
          />
          <TextArea
            label="想记录什么？"
            value={content}
            onChange={setContent}
            rows={4}
            maxLength={2000}
            placeholder="今天的风、路上的人，或一个值得纪念的瞬间…"
          />
          <HStack gap={2} vAlign="center" justify="between">
            <Button
              label={place ? '更换地点' : '添加地点'}
              variant="secondary"
              onClick={() => setPlaceOpen(true)}
            />
            <Text type="supporting">{place ? place.location : '地点可选'}</Text>
          </HStack>
          {place ? (
            <Button label="移除地点" variant="ghost" onClick={() => setPlace(null)} />
          ) : null}
          <FileInput
            label="照片"
            isOptional
            mode="input"
            accept="image/jpeg,image/png,image/webp,image/gif"
            maxSize={MAX_IMAGE_BYTES}
            value={file}
            onChange={next => {
              const picked = Array.isArray(next) ? next[0] || null : next;
              setFile(picked);
              setMessage('');
            }}
            description="支持 JPEG、PNG、WebP、GIF，最大 10 MB。"
          />
          {preview ? (
            <VStack gap={1}>
              <img
                {...stylex.props(styles.preview)}
                src={preview}
                alt="待发布图片的预览"
              />
              <Button label="移除照片" variant="ghost" onClick={() => setFile(null)} />
            </VStack>
          ) : null}
          {message ? <Text type="supporting" color="secondary">{message}</Text> : null}
        </VStack>
      </Dialog>
      <PlaceDialog
        isOpen={placeOpen}
        initial={place}
        onOpenChange={setPlaceOpen}
        onConfirm={result => {
          setPlaceOpen(false);
          if (!result || result.clear) {
            setPlace(null);
            return;
          }
          setPlace(result);
        }}
      />
    </>
  );
}
