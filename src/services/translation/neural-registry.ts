import type { NeuralModelInfo } from './types.ts'
import { nllbNeuralModel } from './nllb.ts'
import { opusMtNeuralModel } from './phrase.ts'

const STORAGE_KEY = 'yomeru:neural-model'

export const neuralModels: NeuralModelInfo[] = [nllbNeuralModel, opusMtNeuralModel]

export function getSelectedNeuralModelId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? nllbNeuralModel.id
  } catch {
    return nllbNeuralModel.id
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
