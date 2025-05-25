import React from 'react';
import {
  MediaDeviceMenu,
  TrackReference,
  TrackToggle,
  useLocalParticipant,
  VideoTrack,
} from '@livekit/components-react';
import { isLocalTrack, LocalTrackPublication, Track, LocalVideoTrack } from 'livekit-client';

// Background color options
const BACKGROUND_COLORS = [
  { name: 'Blue', color: '#3b82f6' },
  { name: 'Green', color: '#22c55e' },
  { name: 'Purple', color: '#a21caf' },
  { name: 'Gray', color: '#6b7280' },
  { name: 'White', color: '#fff' },
];

type BackgroundType = 'none' | 'blur' | 'color';

export function CameraSettings() {
  // Only call useLocalParticipant inside a LiveKitRoom context
  if (typeof window === 'undefined') return null;
  let cameraTrack, localParticipant;
  try {
    // This will throw if not in a room context
    ({ cameraTrack, localParticipant } = useLocalParticipant());
  } catch (e) {
    // Optionally render a fallback UI or nothing if not in room context
    return null;
  }

  const [backgroundType, setBackgroundType] = React.useState<BackgroundType>(
    (cameraTrack as LocalTrackPublication)?.track?.getProcessor()?.name === 'background-blur'
      ? 'blur'
      : 'none',
  );
  const [backgroundColor, setBackgroundColor] = React.useState<string | null>(null);

  const camTrackRef: TrackReference | undefined = React.useMemo(() => {
    return cameraTrack
      ? { participant: localParticipant, publication: cameraTrack, source: Track.Source.Camera }
      : undefined;
  }, [localParticipant, cameraTrack]);

  const selectBackground = (type: BackgroundType, color?: string) => {
    setBackgroundType(type);
    if (type === 'color' && color) {
      setBackgroundColor(color);
    } else if (type !== 'color') {
      setBackgroundColor(null);
    }
  };

  React.useEffect(() => {
    if (typeof window !== 'undefined' && cameraTrack?.track) {
      // Check if the track is a LocalVideoTrack before using setProcessor
      if (cameraTrack.track instanceof LocalVideoTrack) {
        if (backgroundType === 'blur') {
          import('@livekit/track-processors').then(({ BackgroundBlur }) => {
            (cameraTrack.track as LocalVideoTrack).setProcessor(BackgroundBlur());
          });
        } else {
          (cameraTrack.track as LocalVideoTrack).stopProcessor();
        }
      }
    }
  }, [cameraTrack, backgroundType]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {camTrackRef && (
        <div
          style={{
            maxHeight: '280px',
            objectFit: 'contain',
            objectPosition: 'right',
            transform: 'scaleX(-1)',
            background:
              backgroundType === 'color' && backgroundColor ? backgroundColor : '#000',
            borderRadius: 12,
            overflow: 'hidden',
            height: 200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <VideoTrack
            style={{ width: '100%', height: '100%' }}
            trackRef={camTrackRef}
          />
        </div>
      )}

      <section className="lk-button-group">
        <TrackToggle source={Track.Source.Camera}>Camera</TrackToggle>
        <div className="lk-button-group-menu">
          <MediaDeviceMenu kind="videoinput" />
        </div>
      </section>

      <div style={{ marginTop: '10px' }}>
        <div style={{ marginBottom: '8px' }}>Background Effects</div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            onClick={() => selectBackground('none')}
            className="lk-button"
            aria-pressed={backgroundType === 'none'}
            style={{
              border: backgroundType === 'none' ? '2px solid #0090ff' : '1px solid #d1d1d1',
              minWidth: '80px',
            }}
          >
            None
          </button>

          <button
            onClick={() => selectBackground('blur')}
            className="lk-button"
            aria-pressed={backgroundType === 'blur'}
            style={{
              border: backgroundType === 'blur' ? '2px solid #0090ff' : '1px solid #d1d1d1',
              minWidth: '80px',
              backgroundColor: '#f0f0f0',
              position: 'relative',
              overflow: 'hidden',
              height: '60px',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: '#e0e0e0',
                filter: 'blur(8px)',
                zIndex: 0,
              }}
            />
            <span
              style={{
                position: 'relative',
                zIndex: 1,
                backgroundColor: 'rgba(0,0,0,0.6)',
                padding: '2px 5px',
                borderRadius: '4px',
                fontSize: '12px',
              }}
            >
              Blur
            </span>
          </button>

          {BACKGROUND_COLORS.map((color) => (
            <button
              key={color.color}
              onClick={() => selectBackground('color', color.color)}
              className="lk-button"
              aria-pressed={backgroundType === 'color' && backgroundColor === color.color}
              style={{
                background: color.color,
                width: '80px',
                height: '60px',
                border:
                  backgroundType === 'color' && backgroundColor === color.color
                    ? '2px solid #0090ff'
                    : '1px solid #d1d1d1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span
                style={{
                  backgroundColor: 'rgba(0,0,0,0.6)',
                  color: '#fff',
                  padding: '2px 5px',
                  borderRadius: '4px',
                  fontSize: '12px',
                }}
              >
                {color.name}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
