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
import { AIAssistant } from '../../../lib/AIAssistant';

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

  // Helper to assign a color to each user
  const userColorMap: Record<string, string> = {};
  const colorPalette = [
    '#FFB300', '#803E75', '#FF6800', '#A6BDD7', '#C10020', '#CEA262', '#817066',
    '#007D34', '#F6768E', '#00538A', '#FF7A5C', '#53377A', '#FF8E00', '#B32851',
    '#F4C800', '#7F180D', '#93AA00', '#593315', '#F13A13', '#232C16',
  ];
  function getUserColor(name: string) {
    if (!userColorMap[name]) {
      // Assign a color from the palette, cycling if needed
      const idx = Object.keys(userColorMap).length % colorPalette.length;
      userColorMap[name] = colorPalette[idx];
    }
    return userColorMap[name];
  }

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
        <AIAssistant roomName={props.connectionDetails.roomName} />
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
  const { send, chatMessages } = useChat();
  const recognitionRef = React.useRef<any>(null);

  // Listen for incoming transcript chat messages
  React.useEffect(() => {
    // Only process new messages
    if (!chatMessages || chatMessages.length === 0) return;
    const lastMsg = chatMessages[chatMessages.length - 1];
    
    // Process all messages, not just transcript ones
    if (typeof lastMsg.message === 'string') {
      const text = lastMsg.message.replace(/^💬 /, '').trim();
      // Avoid duplicate if it's from self and already added
      setTranscriptList((prev) => {
        // If last transcript is same, skip
        if (prev.length > 0 && prev[prev.length - 1].text === text && prev[prev.length - 1].name === lastMsg.from?.name) {
          return prev;
        }
        return [
          ...prev,
          { name: lastMsg.from?.name || 'Unknown', text },
        ];
      });
      setShowTranscript(true);
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
      hideTimeout.current = setTimeout(() => setShowTranscript(false), 3000);
    }
  }, [chatMessages, setTranscriptList, setShowTranscript, hideTimeout]);

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
        // Send to chat with transcript prefix
        send(`💬 ${message}`);
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') {
        // Optionally show a user-friendly message or ignore silently
        console.warn('No speech detected. Please try speaking again.');
        setIsListening(false);
        return;
      }
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

  // Helper to assign a color to each user
  const userColorMap: Record<string, string> = {};
  const colorPalette = [
    '#FFB300', '#803E75', '#FF6800', '#A6BDD7', '#C10020', '#CEA262', '#817066',
    '#007D34', '#F6768E', '#00538A', '#FF7A5C', '#53377A', '#FF8E00', '#B32851',
    '#F4C800', '#7F180D', '#93AA00', '#593315', '#F13A13', '#232C16',
  ];
  function getUserColor(name: string) {
    if (!userColorMap[name]) {
      // Assign a color from the palette, cycling if needed
      const idx = Object.keys(userColorMap).length % colorPalette.length;
      userColorMap[name] = colorPalette[idx];
    }
    return userColorMap[name];
  }

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
            top: dragPos ? dragPos.y : 'auto',
            bottom: dragPos ? 'auto' : '2rem',
            left: dragPos ? dragPos.x : '50%',
            transform: dragPos ? 'none' : 'translateX(-50%)',
            background: 'var(--surface-color)',
            color: 'var(--text-primary)',
            padding: '1.5rem',
            borderRadius: '1rem',
            minWidth: '320px',
            maxWidth: '500px',
            zIndex: 1000,
            cursor: 'move',
            maxHeight: '300px',
            overflowY: 'auto',
            userSelect: 'none',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
            border: '1px solid var(--border-color)',
          }}
          onMouseDown={onMouseDown}
        >
          <div style={{ whiteSpace: 'pre-line' }}>
            {transcriptList.slice(-4).map((item, idx) => (
              <div 
                key={idx} 
                style={{ 
                  marginBottom: '1rem',
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  backgroundColor: 'rgba(0, 0, 0, 0.2)',
                }}
              >
                <div style={{ 
                  color: getUserColor(item.name),
                  fontWeight: '500',
                  marginBottom: '0.25rem',
                  fontSize: '0.875rem',
                }}>
                  {item.name}
                </div>
                <div style={{ 
                  color: 'var(--text-secondary)',
                  fontSize: '0.875rem',
                  lineHeight: '1.5',
                }}>
                  {item.text}
                </div>
              </div>
            ))}
            {interimText && (
              <div style={{ 
                opacity: 0.7,
                fontStyle: 'italic',
                padding: '0.75rem',
                borderRadius: '0.5rem',
                backgroundColor: 'rgba(0, 0, 0, 0.2)',
                marginBottom: '1rem',
              }}>
                <div style={{ 
                  color: getUserColor(userChoices.username || 'Me'),
                  fontWeight: '500',
                  marginBottom: '0.25rem',
                  fontSize: '0.875rem',
                }}>
                  {userChoices.username || 'Me'}
                </div>
                <div style={{ 
                  color: 'var(--text-secondary)',
                  fontSize: '0.875rem',
                  lineHeight: '1.5',
                }}>
                  {interimText}
                </div>
              </div>
            )}
            {transcriptList.length === 0 && !interimText && (
              <div style={{ 
                opacity: 0.7,
                color: 'var(--text-secondary)',
                fontSize: '0.875rem',
                textAlign: 'center',
                padding: '1rem',
              }}>
                {isListening ? 'Listening...' : 'No transcript yet'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
