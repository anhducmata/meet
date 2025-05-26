'use client';

import React from 'react';
import { decodePassphrase } from '@/lib/client-utils';
import { DebugMode } from '@/lib/Debug';
import { KeyboardShortcuts } from '@/lib/KeyboardShortcuts';
import { RecordingIndicator } from '@/lib/RecordingIndicator';
import { SettingsMenu } from '@/lib/SettingsMenu';
import { ConnectionDetails } from '@/lib/types';
import { LiveKitRoom } from '@livekit/components-react';
import {
  formatChatMessageLinks,
  LocalUserChoices,
  PreJoin,
  RoomContext,
  VideoConference,
  useChat,
} from '@livekit/components-react';
import {
  ExternalE2EEKeyProvider,
  RoomOptions,
  VideoCodec,
  VideoPresets,
  Room,
  DeviceUnsupportedError,
  RoomConnectOptions,
  RoomEvent,
} from 'livekit-client';
import { useRouter } from 'next/navigation';

const CONN_DETAILS_ENDPOINT =
  process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ?? '/api/connection-details';
const SHOW_SETTINGS_MENU = process.env.NEXT_PUBLIC_SHOW_SETTINGS_MENU == 'true';

export function PageClientImpl(props: {
  roomName: string;
  region?: string;
  hq: boolean;
  codec: VideoCodec;
}) {
  const [preJoinChoices, setPreJoinChoices] = React.useState<LocalUserChoices | undefined>(
    undefined,
  );
  const preJoinDefaults = React.useMemo(() => {
    return {
      username: '',
      videoEnabled: true,
      audioEnabled: true,
    };
  }, []);
  const [connectionDetails, setConnectionDetails] = React.useState<ConnectionDetails | undefined>(
    undefined,
  );

  const handlePreJoinSubmit = React.useCallback(async (values: LocalUserChoices) => {
    setPreJoinChoices(values);
    const url = new URL(CONN_DETAILS_ENDPOINT, window.location.origin);
    url.searchParams.append('roomName', props.roomName);
    url.searchParams.append('participantName', values.username);
    if (props.region) {
      url.searchParams.append('region', props.region);
    }
    const connectionDetailsResp = await fetch(url.toString());
    const connectionDetailsData = await connectionDetailsResp.json();
    setConnectionDetails(connectionDetailsData);
  }, []);
  const handlePreJoinError = React.useCallback((e: any) => console.error(e), []);

  return (
    <main data-lk-theme="default" style={{ height: '100%' }}>
      {connectionDetails === undefined || preJoinChoices === undefined ? (
        <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
          <PreJoin
            defaults={preJoinDefaults}
            onSubmit={handlePreJoinSubmit}
            onError={handlePreJoinError}
          />
        </div>
      ) : (
        <VideoConferenceComponent
          connectionDetails={connectionDetails}
          userChoices={preJoinChoices}
          options={{ codec: props.codec, hq: props.hq }}
        />
      )}
    </main>
  );
}

function VideoConferenceComponent(props: {
  userChoices: LocalUserChoices;
  connectionDetails: ConnectionDetails;
  options: {
    hq: boolean;
    codec: VideoCodec;
  };
}) {
  const e2eePassphrase =
    typeof window !== 'undefined' && decodePassphrase(location.hash.substring(1));

  const worker =
    typeof window !== 'undefined' &&
    e2eePassphrase &&
    new Worker(new URL('livekit-client/e2ee-worker', import.meta.url));
  const e2eeEnabled = !!(e2eePassphrase && worker);
  const keyProvider = new ExternalE2EEKeyProvider();
  const [e2eeSetupComplete, setE2eeSetupComplete] = React.useState(false);

  // Transcript state
  const [transcriptList, setTranscriptList] = React.useState<{ name: string; text: string }[]>([]);
  const [isListening, setIsListening] = React.useState(false);
  const [showTranscript, setShowTranscript] = React.useState(true);
  const [dragPos, setDragPos] = React.useState<{ x: number; y: number } | null>(null);
  const [retryCount, setRetryCount] = React.useState(0);
  const dragOffset = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const transcriptRef = React.useRef<HTMLDivElement>(null);
  const hideTimeout = React.useRef<NodeJS.Timeout>();
  const retryTimeout = React.useRef<NodeJS.Timeout>();
  const maxRetries = 3;
  const [interimText, setInterimText] = React.useState('');
  const startRecognition = React.useCallback((recognition: any) => {
    try {
      recognition.start();
      setIsListening(true);
      setRetryCount(0); // Reset retry count on successful start
    } catch (err) {
      console.error('Error starting speech recognition:', err);
      setIsListening(false);
    }
  }, []);

  const roomOptions = React.useMemo((): RoomOptions => {
    let videoCodec: VideoCodec | undefined = props.options.codec ? props.options.codec : 'vp9';
    if (e2eeEnabled && (videoCodec === 'av1' || videoCodec === 'vp9')) {
      videoCodec = undefined;
    }
    return {
      videoCaptureDefaults: {
        deviceId: props.userChoices.videoDeviceId ?? undefined,
        resolution: props.options.hq ? VideoPresets.h2160 : VideoPresets.h720,
      },
      publishDefaults: {
        dtx: false,
        videoSimulcastLayers: props.options.hq
          ? [VideoPresets.h1080, VideoPresets.h720]
          : [VideoPresets.h540, VideoPresets.h216],
        red: !e2eeEnabled,
        videoCodec,
      },
      audioCaptureDefaults: {
        deviceId: props.userChoices.audioDeviceId ?? undefined,
      },
      adaptiveStream: { pixelDensity: 'screen' },
      dynacast: true,
      e2ee: e2eeEnabled
        ? {
            keyProvider,
            worker,
          }
        : undefined,
    };
  }, [props.userChoices, props.options.hq, props.options.codec]);

  // Create the room instance, and update if roomOptions changes
  const room = React.useMemo(() => new Room(roomOptions), [roomOptions]);

  React.useEffect(() => {
    if (e2eeEnabled) {
      keyProvider
        .setKey(decodePassphrase(e2eePassphrase))
        .then(() => {
          room.setE2EEEnabled(true).catch((e) => {
            if (e instanceof DeviceUnsupportedError) {
              alert(
                `You're trying to join an encrypted meeting, but your browser does not support it. Please update it to the latest version and try again.`,
              );
              console.error(e);
            } else {
              throw e;
            }
          });
        })
        .then(() => setE2eeSetupComplete(true));
    } else {
      setE2eeSetupComplete(true);
    }
  }, [e2eeEnabled, room, e2eePassphrase]);

  const connectOptions = React.useMemo((): RoomConnectOptions => {
    return {
      autoSubscribe: true,
    };
  }, []);

  React.useEffect(() => {
    room.on(RoomEvent.Disconnected, handleOnLeave);
    room.on(RoomEvent.EncryptionError, handleEncryptionError);
    room.on(RoomEvent.MediaDevicesError, handleError);
    if (e2eeSetupComplete) {
      room
        .connect(
          props.connectionDetails.serverUrl,
          props.connectionDetails.participantToken,
          connectOptions,
        )
        .catch((error) => {
          handleError(error);
        });
      if (props.userChoices.videoEnabled) {
        room.localParticipant.setCameraEnabled(true).catch((error) => {
          handleError(error);
        });
      }
      if (props.userChoices.audioEnabled) {
        room.localParticipant.setMicrophoneEnabled(true).catch((error) => {
          handleError(error);
        });
      }
    }
    return () => {
      room.off(RoomEvent.Disconnected, handleOnLeave);
      room.off(RoomEvent.EncryptionError, handleEncryptionError);
      room.off(RoomEvent.MediaDevicesError, handleError);
    };
  }, [e2eeSetupComplete, room, props.connectionDetails, props.userChoices]);

  const router = useRouter();
  const handleOnLeave = React.useCallback(() => router.push('/'), [router]);
  const handleError = React.useCallback((error: Error) => {
    console.error(error);
    alert(`Encountered an unexpected error, check the console logs for details: ${error.message}`);
  }, []);
  const handleEncryptionError = React.useCallback((error: Error) => {
    console.error(error);
    alert(
      `Encountered an unexpected encryption error, check the console logs for details: ${error.message}`,
    );
  }, []);

  // Mouse event handlers for drag
  const onMouseDown = (e: React.MouseEvent) => {
    if (!transcriptRef.current) return;
    const rect = transcriptRef.current.getBoundingClientRect();
    dragOffset.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const onMouseMove = (e: MouseEvent) => {
    setDragPos({
      x: e.clientX - dragOffset.current.x,
      y: e.clientY - dragOffset.current.y,
    });
  };

  const onMouseUp = () => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };

  return (
    <LiveKitRoom
      token={props.connectionDetails.participantToken}
      serverUrl={props.connectionDetails.serverUrl}
      connectOptions={connectOptions}
      video={props.userChoices.videoEnabled}
      audio={props.userChoices.audioEnabled}
      onDisconnected={handleOnLeave}
      room={room}
    >
      <RoomContext.Provider value={room}>
        <VideoConferenceContent
          userChoices={props.userChoices}
          transcriptList={transcriptList}
          setTranscriptList={setTranscriptList}
          isListening={isListening}
          setIsListening={setIsListening}
          showTranscript={showTranscript}
          setShowTranscript={setShowTranscript}
          dragPos={dragPos}
          setDragPos={setDragPos}
          dragOffset={dragOffset}
          transcriptRef={transcriptRef}
          hideTimeout={hideTimeout}
          retryTimeout={retryTimeout}
          maxRetries={maxRetries}
          interimText={interimText}
          setInterimText={setInterimText}
          retryCount={retryCount}
          setRetryCount={setRetryCount}
        />
      </RoomContext.Provider>
    </LiveKitRoom>
  );
}

function VideoConferenceContent({
  userChoices,
  transcriptList,
  setTranscriptList,
  isListening,
  setIsListening,
  showTranscript,
  setShowTranscript,
  dragPos,
  setDragPos,
  dragOffset,
  transcriptRef,
  hideTimeout,
  retryTimeout,
  maxRetries,
  interimText,
  setInterimText,
  retryCount,
  setRetryCount,
}: {
  userChoices: LocalUserChoices;
  transcriptList: { name: string; text: string }[];
  setTranscriptList: React.Dispatch<React.SetStateAction<{ name: string; text: string }[]>>;
  isListening: boolean;
  setIsListening: React.Dispatch<React.SetStateAction<boolean>>;
  showTranscript: boolean;
  setShowTranscript: React.Dispatch<React.SetStateAction<boolean>>;
  dragPos: { x: number; y: number } | null;
  setDragPos: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  dragOffset: React.MutableRefObject<{ x: number; y: number }>;
  transcriptRef: React.RefObject<HTMLDivElement>;
  hideTimeout: React.MutableRefObject<NodeJS.Timeout | undefined>;
  retryTimeout: React.MutableRefObject<NodeJS.Timeout | undefined>;
  maxRetries: number;
  interimText: string;
  setInterimText: React.Dispatch<React.SetStateAction<string>>;
  retryCount: number;
  setRetryCount: React.Dispatch<React.SetStateAction<number>>;
}) {
  const { send } = useChat();
  const recognitionRef = React.useRef<any>(null);

  React.useEffect(() => {
    if (!userChoices.audioEnabled) return;
    let isRecognitionActive = false;

    const SpeechRecognition =
      (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) {
      console.error('Speech recognition not supported in this browser.');
      return;
    }

    // Clean up any previous recognition instance
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onresult = null;
      recognitionRef.current.onstart = null;
      try {
        recognitionRef.current.stop();
      } catch {}
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      isRecognitionActive = true;
    };

    recognition.onend = () => {
      isRecognitionActive = false;
      setIsListening(false);
      if (userChoices.audioEnabled && retryCount < maxRetries) {
        if (retryTimeout.current) clearTimeout(retryTimeout.current);
        retryTimeout.current = setTimeout(() => {
          if (!isRecognitionActive && recognitionRef.current) {
            try {
              recognitionRef.current.start();
            } catch (err) {
              console.error('Error restarting speech recognition:', err);
            }
          }
        }, 1000);
      }
    };

    recognition.onresult = (event: any) => {
      let interimTranscript = '';
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }
      setInterimText(interimTranscript);
      if (finalTranscript) {
        const message = finalTranscript.trim();
        setTranscriptList((prev) => [
          ...prev,
          { name: userChoices.username || 'Me', text: message },
        ]);
        setShowTranscript(true);
        if (hideTimeout.current) clearTimeout(hideTimeout.current);
        hideTimeout.current = setTimeout(() => setShowTranscript(false), 3000);
        send(`💬 ${message}`);
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
      if (event.error === 'network') {
        if (retryCount < maxRetries) {
          console.log(`Retrying speech recognition... Attempt ${retryCount + 1}/${maxRetries}`);
          setRetryCount((prev) => prev + 1);
          if (retryTimeout.current) clearTimeout(retryTimeout.current);
          retryTimeout.current = setTimeout(() => {
            if (!isRecognitionActive && recognitionRef.current) {
              try {
                recognitionRef.current.start();
              } catch (err) {
                console.error('Error restarting speech recognition:', err);
              }
            }
          }, 1000);
        }
      }
    };

    try {
      recognition.start();
      setIsListening(true);
    } catch (err) {
      console.error('Error starting speech recognition:', err);
      setIsListening(false);
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.onstart = null;
        try {
          recognitionRef.current.stop();
        } catch {}
      }
      if (retryTimeout.current) clearTimeout(retryTimeout.current);
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
    };
  }, [userChoices.audioEnabled, retryCount, maxRetries, send]);

  return (
    <div className="lk-room-container">
      <KeyboardShortcuts />
      <VideoConference
        chatMessageFormatter={formatChatMessageLinks}
        SettingsComponent={SHOW_SETTINGS_MENU ? SettingsMenu : undefined}
      />
      <DebugMode />
      <RecordingIndicator />
      {(showTranscript || interimText) && (
        <div
          ref={transcriptRef}
          style={{
            position: 'fixed',
            top: dragPos ? dragPos.y : '50%',
            left: dragPos ? dragPos.x : '50%',
            transform: dragPos ? 'none' : 'translate(-50%, -50%)',
            background: 'rgba(0,0,0,0.7)',
            color: '#fff',
            padding: '16px',
            borderRadius: '8px',
            minWidth: '300px',
            maxWidth: '500px',
            zIndex: 1000,
            cursor: 'move',
            maxHeight: '400px',
            overflowY: 'auto',
          }}
        >
          <div style={{ whiteSpace: 'pre-line' }}>
            {transcriptList.slice(-4).map((item, idx) => (
              <div key={idx} style={{ marginBottom: '8px' }}>
                <strong>{item.name}:</strong> {item.text}
              </div>
            ))}
            {interimText && (
              <div style={{ opacity: 0.7, fontStyle: 'italic' }}>
                {userChoices.username || 'Me'}: {interimText}
              </div>
            )}
            {transcriptList.length === 0 && !interimText && (
              <div style={{ opacity: 0.7 }}>{isListening ? 'Listening...' : 'No transcript yet'}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
