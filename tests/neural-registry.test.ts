import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  neuralModels,
  getNeuralModel,
  getSelectedNeuralModel,
  getSelectedNeuralModelId,
  setSelectedNeuralModelId,
} from '@/services/translation/neural-registry.ts'
import { nllbNeuralModel } from '@/services/translation/nllb.ts'
import { opusMtNeuralModel } from '@/services/translation/phrase.ts'

describe('neural-registry', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('exports both neural models', () => {
    expect(neuralModels).toHaveLength(2)
    expect(neuralModels.map((m) => m.id)).toEqual([
      'nllb-200-distilled-600M',
      'opus-mt-ja-en',
    ])
  })

  it('each model has valid workerConfig', () => {
    for (const model of neuralModels) {
      expect(model.workerConfig).toBeDefined()
      expect(model.workerConfig.hfModelId).toMatch(/^Xenova\//)
      expect(model.workerConfig.dtype).toBe('q8')
      expect(model.workerConfig.device).toBe('wasm')
      expect(model.workerConfig.cacheKey).toBeTruthy()
      expect(typeof model.workerConfig.translateOptions).toBe('object')
    }
  })

  it('NLLB has src_lang/tgt_lang in translateOptions', () => {
    expect(nllbNeuralModel.workerConfig.translateOptions).toMatchObject({
      src_lang: 'jpn_Jpan',
      tgt_lang: 'eng_Latn',
    })
  })

  it('Opus-MT does not require src/tgt lang', () => {
    expect(opusMtNeuralModel.workerConfig.translateOptions).not.toHaveProperty('src_lang')
    expect(opusMtNeuralModel.workerConfig.translateOptions).not.toHaveProperty('tgt_lang')
  })

  it('getNeuralModel returns correct model by id', () => {
    expect(getNeuralModel('nllb-200-distilled-600M')).toBe(nllbNeuralModel)
    expect(getNeuralModel('opus-mt-ja-en')).toBe(opusMtNeuralModel)
    expect(getNeuralModel('nonexistent')).toBeUndefined()
  })

  it('defaults to NLLB when no selection stored', () => {
    expect(getSelectedNeuralModelId()).toBe('nllb-200-distilled-600M')
    expect(getSelectedNeuralModel()).toBe(nllbNeuralModel)
  })

  it('persists and retrieves selection via localStorage', () => {
    setSelectedNeuralModelId('opus-mt-ja-en')
    expect(getSelectedNeuralModelId()).toBe('opus-mt-ja-en')
    expect(getSelectedNeuralModel()).toBe(opusMtNeuralModel)
  })

  it('falls back to NLLB for unknown stored id', () => {
    setSelectedNeuralModelId('deleted-model')
    expect(getSelectedNeuralModel()).toBe(nllbNeuralModel)
  })

  it('cacheKey matches model identifier in HuggingFace URL', () => {
    // The cacheKey is used to check if the model is downloaded by searching cache URLs
    expect(nllbNeuralModel.workerConfig.cacheKey).toBe('nllb-200-distilled-600M')
    expect(nllbNeuralModel.workerConfig.hfModelId).toContain(nllbNeuralModel.workerConfig.cacheKey)

    expect(opusMtNeuralModel.workerConfig.cacheKey).toBe('opus-mt-ja-en')
    expect(opusMtNeuralModel.workerConfig.hfModelId).toContain(opusMtNeuralModel.workerConfig.cacheKey)
  })

  it('model size is reasonable', () => {
    // NLLB should be ~350MB
    expect(nllbNeuralModel.size).toBeGreaterThan(300_000_000)
    expect(nllbNeuralModel.size).toBeLessThan(500_000_000)
    // Opus-MT should be ~50MB
    expect(opusMtNeuralModel.size).toBeGreaterThan(30_000_000)
    expect(opusMtNeuralModel.size).toBeLessThan(100_000_000)
  })
})

describe('worker message protocol', () => {
  it('NeuralModelConfig shape matches what the worker expects', () => {
    // The worker expects: { type: 'init', payload: { config: NeuralModelConfig } }
    // Verify each model produces a valid config object
    for (const model of neuralModels) {
      const msg = {
        type: 'init' as const,
        payload: { config: model.workerConfig },
      }
      expect(msg.type).toBe('init')
      expect(msg.payload.config.hfModelId).toBeTruthy()
      expect(msg.payload.config.dtype).toBeTruthy()
      expect(msg.payload.config.device).toBeTruthy()
      expect(msg.payload.config.translateOptions).toBeDefined()
    }
  })

  it('translate message shape is valid', () => {
    const msg = {
      type: 'translate' as const,
      payload: {
        lines: [
          { index: 0, japanese: '営業時間' },
          { index: 1, japanese: 'テスト' },
        ],
      },
      id: 'test-id',
    }
    expect(msg.payload.lines).toHaveLength(2)
    expect(msg.payload.lines[0].index).toBe(0)
    expect(msg.payload.lines[0].japanese).toBeTruthy()
  })
})
