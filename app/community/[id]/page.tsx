"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function CommunityChatPage() {
  const params = useParams<{ id: string }>();
  const id = useMemo(() => String(params?.id ?? ""), [params?.id]);
  const { user, isLoading: authLoading } = useAuth();
  const [communityName, setCommunityName] = useState(id);
  const [messages, setMessages] = useState<Array<{ id: string; text: string; senderId: string }>>([]);
  const [messageText, setMessageText] = useState("");
  const [isMember, setIsMember] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const fetchCommunityData = useCallback(async () => {
    if (!id) {
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/communities/${id}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.community?.name) {
          setCommunityName(data.community.name);
        }
        setIsMember(Boolean(data?.community?.isMember));
      }
    } catch (err) {
      console.error("Failed to fetch community:", err);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  const fetchMessages = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/communities/${id}/messages?limit=50`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.messages)) {
          setMessages(
            data.messages.map((m: any) => ({
              id: m.id,
              text: m.text || m.content || "",
              senderId: m.senderId || m.userId || "",
            }))
          );
        }
      }
    } catch (err) {
      console.error("Failed to fetch messages:", err);
    }
  }, [id]);

  useEffect(() => {
    fetchCommunityData();
    fetchMessages();

    // Polling interval for live chat updates
    const interval = setInterval(() => {
      fetchMessages();
    }, 3000);

    return () => clearInterval(interval);
  }, [fetchCommunityData, fetchMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const text = messageText.trim();
    if (!text || !id || !user?.id || !isMember) return;

    try {
      const res = await fetch(`/api/communities/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (res.ok) {
        setMessageText("");
        await fetchMessages();
      }
    } catch (err) {
      console.error("Failed to send message:", err);
    }
  };

  const isDisabled = authLoading || isLoading || !isMember || !messageText.trim();

  return (
    <div className="flex flex-col h-[calc(100dvh-3.5rem)] md:h-[calc(100dvh-4rem)] bg-background">
      <div className="border-b border-border px-4 md:px-6 py-3">
        <h1 className="text-base md:text-lg font-semibold truncate">{communityName}</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-3 overscroll-contain">
        {!isLoading && messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages yet. Start the conversation.</p>
        ) : (
          messages.map((message) => {
            const isOwnMessage = message.senderId === user?.id;

            return (
              <div key={message.id} className={`flex ${isOwnMessage ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[90%] sm:max-w-[80%] lg:max-w-[72%] rounded-lg border px-3 py-2 text-sm md:text-base ${
                    isOwnMessage
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-foreground border-border"
                  }`}
                >
                  <p className="break-words whitespace-pre-wrap">{message.text}</p>
                  <p
                    className={`mt-1 text-xs ${
                      isOwnMessage ? "text-primary-foreground/80" : "text-muted-foreground"
                    }`}
                  >
                    {isOwnMessage ? "You" : message.senderId}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="sticky bottom-0 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90 p-3 md:p-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        {!isMember ? (
          <p className="text-sm text-muted-foreground">Join community to chat</p>
        ) : (
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder="Type a message"
              className="flex-1"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSend();
                }
              }}
            />
            <Button onClick={() => void handleSend()} disabled={isDisabled} className="w-full sm:w-auto">
              Send
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}