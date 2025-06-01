import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: Request) {
  try {
    const { message, history } = await request.json();

    let historyMessage: OpenAI.Chat.ChatCompletionMessageParam | null = null;
    if (history) {
      const historyContent = Array.isArray(history) ? history.join('\n') : history;
      historyMessage = { role: "user", content: historyContent };
    }

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `You are the Interview Assistant.
Your role is to support the interviewer by generating or responding with only one short, precise question or answer, based on:

The candidate's CV

The current topic being discussed in the conversation history

🔹 Strict Rules:

Your response must be 100% context-aware. Always relate to the last discussed topic.

If the interviewer says something like "Any question?" or "Can you elaborate on that?", generate a question that follows the current topic flow.

If the candidate asks a question, answer directly and briefly.

Do not ask generic questions out of context.

Be short, relevant, and accurate. No filler, no explanations.

❗ Output must be:

Just the question or answer — nothing else.

Related to the current technical subject (e.g., if we're talking about SQL indexing, don't suddenly switch to soft skills or leadership).

Be brief. Be precise. Be helpful.`
      },
    ];

    if (historyMessage) {
      messages.push(historyMessage);
    }

    messages.push({
      role: "user",
      content: message
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: messages,
      max_tokens: 1000,
      temperature: 0.4,
    });

    console.log(completion);
    const response = completion.choices[0]?.message?.content || "I'm sorry, I couldn't process that.";

    return NextResponse.json({ response });
  } catch (error) {
    console.error('Error in chat API:', error);
    return NextResponse.json(
      { error: 'Failed to process chat request' },
      { status: 500 }
    );
  }
} 