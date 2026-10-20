declare module 'bun:test' {
  export function describe(name: string, fn: () => void | Promise<void>): void
  export function it(name: string, fn: () => void | Promise<void>): void
  export function test(name: string, fn: () => void | Promise<void>): void
  export function beforeAll(fn: () => void | Promise<void>): void
  export function afterAll(fn: () => void | Promise<void>): void
  export function beforeEach(fn: () => void | Promise<void>): void
  export function afterEach(fn: () => void | Promise<void>): void

  export interface Matchers<T = any> {
    toBe(expected: any): void
    toEqual(expected: any): void
    toBeTrue(): void
    toBeFalse(): void
    toBeGreaterThan(expected: number): void
    toBeGreaterThanOrEqual(expected: number): void
    toBeLessThan(expected: number): void
    toBeLessThanOrEqual(expected: number): void
    toContain(expected: any): void
    toMatch(expected: RegExp | string): void
    toThrow(expected?: any): void
    toBeDefined(): void
    toBeUndefined(): void
    toBeNull(): void
    not: Matchers<T>
  }

  export function expect<T = any>(actual: T): Matchers<T>
}
