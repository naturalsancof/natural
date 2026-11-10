import {useEffect, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {HStack} from '@astryxdesign/core/HStack';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {VStack} from '@astryxdesign/core/VStack';
import {locateMe, reverseGeocode, searchPlaces} from '../lib/geo.js';
import {WorldMap} from './WorldMap.jsx';

export function PlaceDialog({isOpen, initial, onOpenChange, onConfirm}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');
  const [draft, setDraft] = useState(null);
  const [cleared, setCleared] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const hasPoint = Number.isFinite(initial?.lat) && Number.isFinite(initial?.lng);
    setQuery('');
    setResults([]);
    setMessage('');
    setMessageType('');
    setCleared(false);
    setDraft(hasPoint ? {
      lat: initial.lat,
      lng: initial.lng,
      location: initial.location || '',
    } : null);
  }, [isOpen, initial]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const keyword = query.trim();
    if (keyword.length < 2) {
      setResults([]);
      setSearching(false);
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setMessage('搜索中…');
      setMessageType('');
      try {
        const found = await searchPlaces(keyword);
        if (cancelled) {
          return;
        }
        setResults(found);
        if (!found.length) {
          setMessage('没找到，试试更短的词，或直接在地图上点选');
          setMessageType('error');
        } else {
          setMessage('');
        }
      } catch (error) {
        if (!cancelled) {
          console.error('地名搜索失败:', error);
          setMessage('搜索失败，可以直接在地图上点选');
          setMessageType('error');
        }
      } finally {
        if (!cancelled) {
          setSearching(false);
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isOpen, query]);

  async function choose(lat, lng, location) {
    const next = {lat, lng, location: location || ''};
    setDraft(next);
    setCleared(false);
    setResults([]);
    if (!location) {
      setMessage('正在解析地名…');
      const label = await reverseGeocode(lat, lng);
      setDraft(current => {
        if (!current || current.lat !== lat || current.lng !== lng) {
          return current;
        }
        return {...current, location: label};
      });
      setMessage('');
    }
  }

  async function useCurrent() {
    setMessage('正在定位…');
    setMessageType('');
    try {
      const point = await locateMe();
      await choose(point.lat, point.lng);
    } catch (error) {
      setMessage(error.message || '定位失败，请稍后再试');
      setMessageType('error');
    }
  }

  const label = draft
    ? (draft.location || `${draft.lat.toFixed(2)}, ${draft.lng.toFixed(2)}`)
    : (cleared ? '将移除地点' : '未选择地点');

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      purpose="form"
      width={640}
    >
      <VStack gap={3}>
        <DialogHeader
          title="选择地点"
          subtitle="搜索城市，或在地图上点一个位置。"
          onOpenChange={onOpenChange}
        />
        <TextInput
          label="搜索地名"
          type="search"
          value={query}
          onChange={setQuery}
          placeholder="例如 大理、京都、Lisbon"
          isLoading={searching}
          hasAutoFocus
          status={messageType === 'error' ? {type: 'error', message} : undefined}
          description={messageType === 'error' ? undefined : (message || '至少输入两个字')}
        />
        {results.length ? (
          <VStack gap={1}>
            {results.map(item => (
              <Button
                key={`${item.lat}-${item.lng}-${item.name}`}
                variant="ghost"
                width="100%"
                label={item.label}
                onClick={() => choose(item.lat, item.lng, item.label)}
              />
            ))}
          </VStack>
        ) : null}
        <HStack gap={2} vAlign="center" justify="between">
          <Button label="使用当前位置" variant="secondary" onClick={useCurrent} />
          <Text type="supporting">{label}</Text>
        </HStack>
        <HStack gap={2} justify="end">
          {draft || initial?.lat ? (
            <Button
              label="清除地点"
              variant="ghost"
              onClick={() => {
                setDraft(null);
                setCleared(true);
              }}
            />
          ) : null}
          <Button label="取消" variant="ghost" onClick={() => onOpenChange(false)} />
          <Button
            label="确定"
            variant="primary"
            isDisabled={!draft && !cleared}
            onClick={() => {
              if (draft) {
                onConfirm({
                  location: draft.location || `${draft.lat.toFixed(2)}, ${draft.lng.toFixed(2)}`,
                  lat: draft.lat,
                  lng: draft.lng,
                });
                return;
              }
              if (cleared) {
                onConfirm({clear: true});
              }
            }}
          />
        </HStack>
        {isOpen ? (
          <WorldMap
            label="点选地点"
            height={220}
            interactive
            pins={[]}
            marker={draft}
            onPick={point => choose(point.lat, point.lng)}
          />
        ) : null}
      </VStack>
    </Dialog>
  );
}
