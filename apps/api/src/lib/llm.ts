import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { env } from '../config/env';

export const LLM_MODEL = 'gemini-2.0-flash';
export const LLM_MAX_TOKENS = 4000;
export const MODEL_CONTEXT_LIMIT = 1_000_000; // Gemini 2.0 Flash — 1M token window

let genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!genAI) genAI = new GoogleGenerativeAI(env.GOOGLE_API_KEY);
  return genAI;
}

export function getLLM(): GenerativeModel {
  return getGenAI().getGenerativeModel({
    model: LLM_MODEL,
    generationConfig: { maxOutputTokens: LLM_MAX_TOKENS },
  });
}
