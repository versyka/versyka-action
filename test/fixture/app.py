# Test fixture for CI: OpenAI retired the model below on 2026-10-23, so the action must report it.
from openai import OpenAI

client = OpenAI()
reply = client.chat.completions.create(model="gpt-3.5-turbo", messages=[{"role": "user", "content": "Hello"}])
