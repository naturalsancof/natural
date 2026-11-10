import {useEffect, useImperativeHandle, useRef, useState} from 'react';
import * as stylex from '@stylexjs/stylex';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {
  colorVars,
  radiusVars,
  shadowVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import {MAP_HEIGHT, MAP_WIDTH, WORLD_PATH} from '../lib/world-map.js';
import {projectPoint, shortText, unprojectPoint} from '../lib/project.js';

const MIN_SCALE = 1;
const MAX_SCALE = 9;
const DRAG_THRESHOLD = 5;

const styles = stylex.create({
  host: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: colorVars['--color-background-muted'],
  },
  svg: {
    width: '100%',
    height: '100%',
    display: 'block',
    touchAction: 'none',
  },
  interactive: {
    cursor: 'crosshair',
  },
  pin: {
    cursor: 'pointer',
    ':focus-visible': {
      outlineWidth: '2px',
      outlineStyle: 'solid',
      outlineColor: colorVars['--color-border-emphasized'],
      outlineOffset: '2px',
    },
  },
  popup: {
    position: 'absolute',
    zIndex: 2,
    width: 'min(16rem, 80%)',
    maxHeight: '50%',
    overflow: 'auto',
    transform: 'translate(-50%, calc(-100% - var(--spacing-3)))',
    boxShadow: shadowVars['--shadow-med'],
    borderRadius: radiusVars['--radius-container'],
  },
  popupBelow: {
    transform: 'translate(-50%, var(--spacing-3))',
  },
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN');
}

export function WorldMap({
  pins,
  marker = null,
  interactive = false,
  activeNoteId = null,
  onSelectNote,
  onPick,
  onZoomedChange,
  mapRef,
  label = '足迹地图',
  height = 360,
}) {
  const svgRef = useRef(null);
  const popupRef = useRef(null);
  const view = useRef({
    scale: 1,
    center: {x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2},
    base: {w: MAP_WIDTH, h: MAP_HEIGHT},
    userMoved: false,
    fitted: false,
  });
  const pointers = useRef(new Map());
  const drag = useRef({
    dragging: false,
    moved: false,
    suppress: false,
    last: null,
    pinch: null,
  });
  const [viewBox, setViewBox] = useState(`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`);
  const [scale, setScale] = useState(1);
  const [popup, setPopup] = useState(null);

  function publishZoom(nextScale) {
    onZoomedChange?.(nextScale > 1.02);
  }

  function applyView() {
    const current = view.current;
    const width = current.base.w / current.scale;
    const height = current.base.h / current.scale;
    const x = clamp(current.center.x - width / 2, 0, MAP_WIDTH - width);
    const y = clamp(current.center.y - height / 2, 0, MAP_HEIGHT - height);

    current.center = {x: x + width / 2, y: y + height / 2};
    setViewBox(`${x} ${y} ${width} ${height}`);
    setScale(current.scale);
    setPopup(null);
    publishZoom(current.scale);
  }

  function computeBase() {
    const rect = svgRef.current?.getBoundingClientRect();
    const aspect = rect && rect.width > 0 && rect.height > 0
      ? rect.width / rect.height
      : MAP_WIDTH / MAP_HEIGHT;
    let height = MAP_HEIGHT;
    let width = height * aspect;

    if (width > MAP_WIDTH) {
      width = MAP_WIDTH;
      height = width / aspect;
    }

    view.current.base = {w: width, h: height};
  }

  function clientToMap(clientX, clientY) {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) {
      return {x: 0, y: 0};
    }
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const local = point.matrixTransform(matrix.inverse());
    return {x: local.x, y: local.y};
  }

  function zoomAt(clientX, clientY, factor) {
    const current = view.current;
    current.userMoved = true;
    const anchor = clientToMap(clientX, clientY);
    const nextScale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
    if (nextScale === current.scale) {
      return;
    }
    const ratio = current.scale / nextScale;
    current.center = {
      x: anchor.x + (current.center.x - anchor.x) * ratio,
      y: anchor.y + (current.center.y - anchor.y) * ratio,
    };
    current.scale = nextScale;
    applyView();
  }

  function resetView() {
    view.current.scale = 1;
    view.current.center = {x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2};
    applyView();
  }

  useImperativeHandle(mapRef, () => ({resetView}), []);

  useEffect(() => {
    computeBase();
    applyView();

    const svg = svgRef.current;
    if (!svg) {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      computeBase();
      applyView();
    });
    observer.observe(svg);

    const onWheel = event => {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 1 / 1.12);
    };

    svg.addEventListener('wheel', onWheel, {passive: false});
    return () => {
      observer.disconnect();
      svg.removeEventListener('wheel', onWheel);
    };
    // The view lives in a ref. This binds the host once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const current = view.current;
    if (current.userMoved || current.fitted || !pins.length) {
      return;
    }

    current.fitted = true;
    const points = pins.map(pin => projectPoint(pin.lat, pin.lng));
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    current.center = {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    };

    if (window.matchMedia('(max-width: 860px)').matches) {
      const spanX = Math.max(Math.max(...xs) - Math.min(...xs), 40);
      const spanY = Math.max(Math.max(...ys) - Math.min(...ys), 40);
      const pad = 30;
      current.scale = clamp(
        Math.min(
          current.base.w / (spanX + pad * 2),
          current.base.h / (spanY + pad * 2),
        ),
        1,
        3.2,
      );
    }

    applyView();
    // Fitting runs when the first pins arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins]);

  useEffect(() => {
    if (activeNoteId == null) {
      return;
    }

    const pin = pins.find(item => item.notes.some(note => String(note.id) === String(activeNoteId)));
    if (!pin || view.current.userMoved === false && view.current.scale === 1) {
      return;
    }

    const point = projectPoint(pin.lat, pin.lng);
    const current = view.current;
    const halfWidth = current.base.w / current.scale / 2;
    const halfHeight = current.base.h / current.scale / 2;
    const inside = Math.abs(point.x - current.center.x) < halfWidth * 0.7
      && Math.abs(point.y - current.center.y) < halfHeight * 0.7;

    if (inside) {
      return;
    }

    const from = {...current.center};
    const start = performance.now();
    let frame = 0;

    const step = now => {
      const progress = Math.min(1, (now - start) / 420);
      const eased = 1 - (1 - progress) ** 3;
      current.center = {
        x: from.x + (point.x - from.x) * eased,
        y: from.y + (point.y - from.y) * eased,
      };
      applyView();
      if (progress < 1) {
        frame = requestAnimationFrame(step);
      }
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNoteId, pins]);

  useEffect(() => {
    const node = popupRef.current;
    if (!node || !popup) {
      return;
    }
    node.style.left = `${popup.left}px`;
    node.style.top = `${popup.top}px`;
  }, [popup]);

  function openPopup(pin, event) {
    const svg = svgRef.current;
    const host = svg?.parentElement;
    const matrix = svg?.getScreenCTM();
    if (!svg || !host || !matrix) {
      return;
    }

    const point = projectPoint(pin.lat, pin.lng);
    const screen = svg.createSVGPoint();
    screen.x = point.x;
    screen.y = point.y;
    const placed = screen.matrixTransform(matrix);
    const box = host.getBoundingClientRect();
    const top = placed.y - box.top;

    setPopup({
      pin,
      left: clamp(placed.x - box.left, 80, Math.max(80, box.width - 80)),
      top,
      below: top < 130,
    });
    event?.stopPropagation();
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }
    pointers.current.set(event.pointerId, {x: event.clientX, y: event.clientY});
    if (pointers.current.size === 1) {
      drag.current.dragging = true;
      drag.current.moved = false;
      drag.current.suppress = false;
      drag.current.last = {x: event.clientX, y: event.clientY};
      return;
    }
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      drag.current.pinch = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        scale: view.current.scale,
      };
    }
  }

  function onPointerMove(event) {
    if (!pointers.current.has(event.pointerId)) {
      return;
    }
    pointers.current.set(event.pointerId, {x: event.clientX, y: event.clientY});

    if (pointers.current.size === 2 && drag.current.pinch) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (drag.current.pinch.distance > 0) {
        zoomAt( (a.x + b.x) / 2, (a.y + b.y) / 2, distance / drag.current.pinch.distance);
        drag.current.pinch.distance = distance;
      }
      drag.current.moved = true;
      drag.current.suppress = true;
      return;
    }

    if (!drag.current.dragging || !drag.current.last) {
      return;
    }

    const dx = event.clientX - drag.current.last.x;
    const dy = event.clientY - drag.current.last.y;
    if (!drag.current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) {
      return;
    }

    drag.current.moved = true;
    drag.current.suppress = true;
    view.current.userMoved = true;

    const before = clientToMap(drag.current.last.x, drag.current.last.y);
    const after = clientToMap(event.clientX, event.clientY);
    view.current.center = {
      x: view.current.center.x - (after.x - before.x),
      y: view.current.center.y - (after.y - before.y),
    };
    drag.current.last = {x: event.clientX, y: event.clientY};
    applyView();
  }

  function endPointer(event) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) {
      drag.current.pinch = null;
    }
    if (pointers.current.size === 0) {
      drag.current.dragging = false;
      drag.current.last = null;
    }
  }

  function onClick(event) {
    if (drag.current.suppress) {
      drag.current.suppress = false;
      return;
    }

    setPopup(null);

    if (!interactive) {
      return;
    }

    const point = clientToMap(event.clientX, event.clientY);
    if (point.x < 0 || point.y < 0 || point.x > MAP_WIDTH || point.y > MAP_HEIGHT) {
      return;
    }

    const picked = unprojectPoint(point.x, point.y);
    onPick?.({
      lat: Math.max(-85, Math.min(85, picked.lat)),
      lng: picked.lng,
    });
  }

  const pinScale = 1 / scale;

  return (
    <Card padding={0} height={height} xstyle={styles.host}>
      <svg
        ref={svgRef}
        viewBox={viewBox}
        role="img"
        aria-label={label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onDoubleClick={event => {
          event.preventDefault();
          zoomAt(event.clientX, event.clientY, 1.8);
        }}
        onClick={onClick}
        {...stylex.props(styles.svg, interactive && styles.interactive)}
      >
        <path d={WORLD_PATH} fill="var(--color-background-surface)" fillRule="evenodd" />
        {pins.map(pin => {
          const point = projectPoint(pin.lat, pin.lng);
          const active = activeNoteId != null
            && pin.notes.some(note => String(note.id) === String(activeNoteId));
          return (
            <g
              key={pin.key}
              role="button"
              tabIndex={0}
              aria-label={pin.notes.length > 1
                ? `${pin.notes.length} 条留言在这附近`
                : `${pin.notes[0]?.author || '匿名'}的留言`}
              transform={`translate(${point.x} ${point.y}) scale(${pinScale})`}
              onClick={event => openPopup(pin, event)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openPopup(pin, event);
                }
              }}
              {...stylex.props(styles.pin)}
            >
              <circle r="14" fill="transparent" />
              <circle r={active ? 8 : 6.4} fill="var(--color-accent-muted)" />
              <circle r={active ? 4 : 3.1} fill="var(--color-accent)" />
              {pin.notes.length > 1 ? (
                <text
                  y="1.9"
                  textAnchor="middle"
                  fill="var(--color-on-accent)"
                  fontSize="8"
                  fontFamily="var(--font-family-body)"
                >
                  {pin.notes.length}
                </text>
              ) : null}
            </g>
          );
        })}
        {marker ? (
          <g transform={`translate(${projectPoint(marker.lat, marker.lng).x} ${projectPoint(marker.lat, marker.lng).y}) scale(${pinScale})`}>
            <circle r="7" fill="none" stroke="var(--color-text-accent)" strokeWidth="1.5" />
            <circle r="3" fill="var(--color-accent)" />
          </g>
        ) : null}
      </svg>
      {popup ? (
        <Card
          ref={popupRef}
          padding={2}
          elevation="med"
          xstyle={[styles.popup, popup.below && styles.popupBelow]}
        >
          <VStack gap={1}>
            <Text type="label">
              {popup.pin.notes.length > 1
                ? `${popup.pin.notes.length} 条留言在这附近`
                : '这条留言在这里'}
            </Text>
            {popup.pin.notes.map(note => (
              <Button
                key={note.id}
                variant="ghost"
                width="100%"
                label={`${note.author || '匿名'}，${formatDate(note.created_at)}。${shortText(note.content) || note.location || '图片'}`}
                onClick={() => {
                  setPopup(null);
                  onSelectNote?.(note.id);
                }}
              />
            ))}
          </VStack>
        </Card>
      ) : null}
    </Card>
  );
}
