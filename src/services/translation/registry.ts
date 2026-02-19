import type { TranslationModel } from './types.ts'
import { jmdictModel } from './dictionary.ts'

export const translationModels: TranslationModel[] = [jmdictModel]

export function getTranslationModel(id: string): TranslationModel | undefined {
  return translationModels.find((m) => m.id === id)
}

export function getDefaultTranslationModel(): TranslationModel {
  return jmdictModel
}
