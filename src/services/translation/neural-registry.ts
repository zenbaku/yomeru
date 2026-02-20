import type { NeuralModelInfo } from './types.ts'
import { nllbNeuralModel } from './nllb.ts'
import { opusMtNeuralModel } from './phrase.ts'

const STORAGE_KEY = 'yomeru:neural-model'

export const neuralModels: NeuralModelInfo[] = [nllbNeuralModel, opusMtNeuralModel]

/** Pick a sensible default based on device memory. */
function getDefaultModelId(): string {
  const mem = (navigator as { deviceMemory?: number }).deviceMemory
  // On low-memory devices (≤2 GB), default to the lighter Opus-MT (50 MB)
  // instead of NLLB-200 (350 MB) which can cause OOM crashes.
  if (mem !== undefined && mem <= 2) return opusMtNeuralModel.id
  return nllbNeuralModel.id
}

export function getSelectedNeuralModelId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? getDefaultModelId()
  } catch {
    return getDefaultModelId()
  }
}

export function setSelectedNeuralModelId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // localStorage may not be available
  }
}

export function getNeuralModel(id: string): NeuralModelInfo | undefined {
  return neuralModels.find((m) => m.id === id)
}

export function getSelectedNeuralModel(): NeuralModelInfo {
  return getNeuralModel(getSelectedNeuralModelId()) ?? nllbNeuralModel
}
