export const MODELS = [
  {
    id: "google/gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    description: "Deep reasoning · thinking enabled",
  },
  {
    id: "google/gemini-3-flash-preview",
    label: "Gemini 3 Flash",
    description: "Fast · efficient",
  },
] as const;

export type ModelId = typeof MODELS[number]["id"];

export const DEFAULT_MODEL: ModelId = "google/gemini-3-flash-preview";

export function getStoredModel(): ModelId {
  if (typeof window === "undefined") return DEFAULT_MODEL;
  const v = localStorage.getItem("selected_model");
  if (v && MODELS.some((m) => m.id === v)) return v as ModelId;
  return DEFAULT_MODEL;
}

export function setStoredModel(id: ModelId) {
  localStorage.setItem("selected_model", id);
}