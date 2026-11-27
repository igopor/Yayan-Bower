import type { GrantResult } from './index'

/**
 * 语言测评的共用定义：维度、等级、字数、结果结构。
 *
 * 为什么单独一个文件而不是塞进 index.ts：前端（渲染卡片、实时字数）、
 * 服务端（校验、清洗、mock 规则）、单测（枚举边界）三边都要读同一份，
 * 只要有一边自己写一份，就会出现"页面说到 300 字、接口说 299"这类对不上的问题。
 */

/** 少于这个字数看不出表达特点 */
export const ASSESS_MIN_CHARS = 30
/** 默认上限。实际值由 ASSESS_MAX_CHARS 决定，这里只是默认值 */
export const ASSESS_MAX_CHARS_DEFAULT = 300

/**
 * 三档评价。
 *
 * 刻意不用「优秀 / 良好 / 待提升」：这一页是写给孩子看的，
 * "待提升"读起来像判分，"再练练"是同辈之间会说的话。
 * 报告页那段给家长看的文案仍然可以直白，两处不必统一。
 */
export const ASSESS_LEVELS = ['很棒', '不错', '再练练'] as const
export type AssessLevel = (typeof ASSESS_LEVELS)[number]

/**
 * 四个维度。
 *
 * `hint` 是给三到六年级看的白话解释——"连贯"这个词本身不在他们的词汇里，
 * 但"前后接不接得上"是懂的。名字和解释都由前端直接显示，不显示英文 key。
 */
export const ASSESS_DIMENSIONS = [
  { key: 'vocabulary', name: '用词', hint: '选的词准不准' },
  { key: 'fluency', name: '通顺', hint: '句子读得顺不顺' },
  { key: 'richness', name: '丰富', hint: '说法有没有变化' },
  { key: 'cohesion', name: '连贯', hint: '前后接不接得上' },
] as const

export type AssessDimensionKey = (typeof ASSESS_DIMENSIONS)[number]['key']

/** 一个维度的评价。`evidence` 必须是原文里真实存在的一小段，模型编的一律清空 */
export interface AssessDimension {
  key: AssessDimensionKey
  name: string
  level: AssessLevel
  comment: string
  evidence: string
  advice: string
}

export interface AssessOverall {
  level: AssessLevel
  summary: string
  suggestions: string[]
}

export interface AssessResult {
  overall: AssessOverall
  dimensions: AssessDimension[]
}

/**
 * 结果来源。
 * - mock    ：演示通道，本地规则生成（不联网、不花钱）
 * - model   ：真实模型
 * - unavailable：没开启 / 超时 / 报错 / 没通过校验。前端整块不渲染
 */
export type AssessSource = 'mock' | 'model' | 'unavailable'

/** 测评接口的返回体（不含积分，积分在路由层拼） */
export interface AssessView {
  source: AssessSource
  result: AssessResult | null
}

/** 实际下发给前端的结构：多一个积分结果，前端据此决定要不要飘字 */
export interface AssessResponse extends AssessView {
  points: GrantResult | null
}
