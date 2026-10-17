// Тесты съёмки: чистые функции сценария и границы с фабрикой. Площадки и модели - только в дубле.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/*.test.ts'],
    environment: 'node',
  },
});
