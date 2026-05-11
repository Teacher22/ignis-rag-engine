import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { env } from '../config/env';

export const LLM_MODEL = 'gemini-3.1-flash-lite';
export const LLM_MAX_TOKENS = 8000;
export const MODEL_CONTEXT_LIMIT = 1_048_576; // Gemini 3.1 Flash Lite — 1M token window

let genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!genAI) genAI = new GoogleGenerativeAI(env.GOOGLE_API_KEY);
  return genAI;
}

export function getLLM(): GenerativeModel {
  // v1beta is required — v1 doesn't expose systemInstruction or newer models
  return getGenAI().getGenerativeModel(
    { model: LLM_MODEL, generationConfig: { maxOutputTokens: LLM_MAX_TOKENS } },
    { apiVersion: 'v1beta' }
  );
}
