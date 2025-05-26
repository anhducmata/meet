import React, { useState } from 'react';
import { useChat } from '@livekit/components-react';

interface AIAssistantProps {
  roomName: string;
}

export function AIAssistant({ roomName }: AIAssistantProps) {
  const [isAssistantActive, setIsAssistantActive] = useState(false);
  const { send } = useChat();

  const toggleAssistant = () => {
    if (!isAssistantActive) {
      // Add AI assistant as a participant
      send("Hello! I'm your AI assistant. How can I help you today?");
    }
    setIsAssistantActive(!isAssistantActive);
  };

  return (
    <button
      className="lk-button"
      onClick={toggleAssistant}
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        zIndex: 1000,
        backgroundColor: isAssistantActive ? '#4CAF50' : '#2196F3',
        color: 'white',
        padding: '10px 20px',
        borderRadius: '5px',
        border: 'none',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}
    >
      {isAssistantActive ? 'AI Assistant Active' : 'Add AI Assistant'}
      <span role="img" aria-label="robot">
        🤖
      </span>
    </button>
  );
} 