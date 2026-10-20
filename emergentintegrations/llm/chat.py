import asyncio
import os
import google.generativeai as genai
from typing import Optional


class UserMessage:
    def __init__(self, text: str):
        self.text = text


class LlmChat:
    """Gemini AI chat interface for the BugHuntr assistant.

    This provides `with_model` and `send_message` async method used by the API.
    It integrates with Google's Gemini AI to provide intelligent responses.
    """

    def __init__(self, api_key: Optional[str] = None, session_id: str = "default", system_message: str = ""):
        resolved_key = (api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or "").strip()
        if not resolved_key:
            raise ValueError(
                "Gemini AI configuration error: GEMINI_API_KEY or GOOGLE_API_KEY environment variable is required."
            )
        self.api_key = resolved_key
        self.session_id = session_id
        self.system_message = system_message or """You are BugHuntr Assistant, a helpful AI assistant for the BugHuntr platform. 
        You help users navigate the app, understand cybersecurity concepts, provide coding assistance, and answer questions about bug bounty hunting.
        Keep responses concise and helpful. When providing code examples, use proper markdown formatting with code blocks."""
        
        # Configure Gemini
        genai.configure(api_key=self.api_key)
        self.model_name = "gemini-pro"
        self.model = genai.GenerativeModel(self.model_name)
        
        # Start chat session
        self.chat = self.model.start_chat(history=[])

    def with_model(self, provider: str, model_name: str):
        """Set the model provider and name (for compatibility)"""
        if provider == "google" and model_name:
            self.model_name = model_name
            self.model = genai.GenerativeModel(self.model_name)
            self.chat = self.model.start_chat(history=[])
        return self

    async def send_message(self, user_message: UserMessage) -> str:
        try:
            # Add system context to the first message
            if len(self.chat.history) == 0:
                full_message = f"{self.system_message}\n\nUser: {user_message.text}"
            else:
                full_message = user_message.text
            
            # Send message to Gemini
            response = await asyncio.to_thread(self.chat.send_message, full_message)
            
            return response.text
            
        except Exception as e:
            print(f"Error with Gemini API: {e}")
            # Fallback response
            return f"I apologize, but I'm having trouble processing your request right now. Please try again later. (Error: {str(e)})"
