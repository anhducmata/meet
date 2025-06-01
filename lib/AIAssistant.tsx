import React, { useState, useRef, useEffect } from 'react';
import { useChat } from '@livekit/components-react';
import styles from '../styles/AIAssistant.module.css';

interface AIAssistantProps {
  roomName: string;
}

export function AIAssistant({ roomName }: AIAssistantProps) {
  const [isAssistantActive, setIsAssistantActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { send, chatMessages } = useChat();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const lastProcessedMessageRef = useRef<string>('');
  const isProcessingRef = useRef(isProcessing); // Ref to keep track of isProcessing in effects

  useEffect(() => {
      isProcessingRef.current = isProcessing;
  }, [isProcessing]);

  // Handle incoming chat messages
  useEffect(() => {
    if (!isAssistantActive || isProcessingRef.current || !chatMessages || chatMessages.length === 0) return;

    const lastMessage = chatMessages[chatMessages.length - 1];
    const messageContent = lastMessage.message?.toString()?.trim() || '';
    
    // Skip if it's the AI's own message or already processed
    if (lastMessage.from?.name === 'AI Assistant' || 
        messageContent === lastProcessedMessageRef.current ||
        !messageContent.toLowerCase().startsWith('hey assistant')) {
      return;
    }

    // Process the message after the trigger phrase
    const messageToProcess = messageContent.substring('hey assistant'.length).trim();
    if (messageToProcess) {
      handleAIResponse(messageToProcess);
      lastProcessedMessageRef.current = messageContent; // Store original message to prevent re-processing
    }

  }, [chatMessages, isAssistantActive, send]); // Added `send` dependency as it's used in handleAIResponse

  // --- Speech Recording and Processing (OpenAI Whisper) ---
  const startRecording = async () => {
    if (!navigator.mediaDevices) {
      console.error('Media Devices API not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunks.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        audioChunks.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = async () => {
        setIsProcessing(true);
        const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm' });
        console.log('Recording stopped, processing audio...', audioBlob);

        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');

        try {
          const transcribeResponse = await fetch('/api/transcribe', {
            method: 'POST',
            body: formData,
          });
          const transcribeData = await transcribeResponse.json();
          const transcribedText = transcribeData.text?.trim() || '';
          console.log('Transcribed Text:', transcribedText);
          
          // Check for the trigger phrase in transcribed text
          if (transcribedText.toLowerCase().startsWith('hey assistant')) {
            const messageToProcess = transcribedText.substring('hey assistant'.length).trim();
            if (messageToProcess) {
              handleAIResponse(messageToProcess);
            } else {
                setIsProcessing(false);
            }
          } else {
               setIsProcessing(false);
          }

        } catch (error) {
          console.error('Error during transcription:', error);
          setIsProcessing(false);
        }
      };

      mediaRecorderRef.current.start();
      // setIsRecording(true); // We will use isProcessing to indicate active state
      console.log('Recording started.');
    } catch (err) {
      console.error('Error accessing microphone:', err);
      // setIsRecording(false);
      setIsAssistantActive(false); // Deactivate if mic access fails
      setIsProcessing(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      // setIsRecording(false);
      console.log('Recording stopped.');
    }
  };
  // ---------------------------------------------------------------------

  // --- AI Response Handling (OpenAI TTS) ---
  const handleAIResponse = async (text: string) => {
    setIsProcessing(true); // Indicate processing starts
    try {
      console.log('Sending to chat API:', text);
      const chatResponse = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: text, history: chatMessages.map(msg => msg.message) }), // Include only message content from history
      });
      
      const chatData = await chatResponse.json();
      const aiTextResponse = chatData.response?.trim() || '';
      send(`AI Assistant: ${aiTextResponse}`); // Send to chatbox
      console.log('AI Text Response:', aiTextResponse);

      if (aiTextResponse) {
         console.log('Sending to Text-to-Speech API:', aiTextResponse);
         const synthesizeResponse = await fetch('/api/synthesize', {
           method: 'POST',
           headers: {
             'Content-Type': 'application/json',
           },
           body: JSON.stringify({ text: aiTextResponse }),
         });

         if (!synthesizeResponse.ok) {
             throw new Error(`HTTP error! status: ${synthesizeResponse.status}`);
         }

         const audioBlob = await synthesizeResponse.blob();
         await playAudioResponse(audioBlob);
      }
      

    } catch (error) {
      console.error('Error in AI response process:', error);
    } finally {
      setIsProcessing(false); // Indicate processing ends
    }
  };

  const playAudioResponse = async (audioBlob: Blob) => {
    if (audioContextRef.current === null) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const audioContext = audioContextRef.current;

    // Stop any currently playing audio
    if (audioSourceRef.current) {
        audioSourceRef.current.stop();
        audioSourceRef.current.disconnect();
    }

    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    audioSourceRef.current = audioContext.createBufferSource();
    audioSourceRef.current.buffer = audioBuffer;
    audioSourceRef.current.connect(audioContext.destination);

    audioSourceRef.current.onended = () => {
        console.log('Audio playback finished.');
        audioSourceRef.current = null;
    };

    audioSourceRef.current.start();
    console.log('Playing audio response...');
  };
  // -----------------------------------------------------------------------

  const toggleAssistant = () => {
    if (!isAssistantActive) {
      setIsAssistantActive(true);
       // We might want a separate mic button, but for simplicity, let's auto-start recording
       // when the assistant is activated. Users can just talk.
       startRecording();
      send("Hello! I'm your AI assistant. Please start your message with 'Hey Assistant' for me to respond.");
    } else {
      setIsAssistantActive(false);
      stopRecording();
      // Stop any ongoing speech synthesis
      if (audioSourceRef.current) {
          audioSourceRef.current.stop();
          audioSourceRef.current.disconnect();
          audioSourceRef.current = null;
      }
      console.log('AI Assistant deactivated.');
       setIsProcessing(false); // Ensure processing state is off
    }
  };

   // Effect to stop recording and audio playback when component unmounts
  useEffect(() => {
    return () => {
      stopRecording();
       if (audioSourceRef.current) {
          audioSourceRef.current.stop();
          audioSourceRef.current.disconnect();
          audioSourceRef.current = null;
      }
       if (audioContextRef.current) {
           audioContextRef.current.close();
           audioContextRef.current = null;
       }
    };
  }, []);

  // Update UI state based on isProcessing and isAssistantActive
  const buttonText = isAssistantActive 
    ? (isProcessing ? 'Processing...' : 'Active (Speak/Chat)')
    : 'Activate AI Assistant';

  return (
    <div className={styles.container}>
      <button
        className={`${styles['ai-assistant-button']} ${isAssistantActive ? styles.active : ''} ${isProcessing ? styles.processing : ''}`}
        onClick={toggleAssistant}
        disabled={isProcessing && isAssistantActive} // Disable button when processing while active
      >
        {isProcessing && isAssistantActive ? (
             <div className={styles.spinner} /> // Add a spinner style
        ) : isAssistantActive ? (
          <>
            <div className={styles.pulse} />
            {buttonText}
          </>
        ) : (
          <>
            <span role="img" aria-label="robot">
              🤖
            </span>
            {buttonText}
          </>
        )}
      </button>
    </div>
  );
} 