import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ImportController } from './import.controller';

// ─── Mock Dependencies ────────────────────────────────────────────────────────

function createMockImportService() {
  return {
    upload: vi.fn().mockResolvedValue({
      id: 'import-1',
      status: 'REVIEW',
      fileName: 'test.csv',
      totalRows: 10,
    }),
    getAnalysis: vi.fn(),
    clean: vi.fn(),
    approve: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    getCleanedFilePath: vi.fn(),
    getRejectsFilePath: vi.fn(),
    triggerAIAnalysis: vi.fn(),
    getAIReport: vi.fn(),
    applyAIFix: vi.fn(),
  };
}

/**
 * Creates a mock Fastify multipart file object.
 * Simulates the return of `req.file()` in Fastify with @fastify/multipart.
 */
function createMockMultipartFile(overrides: {
  filename?: string;
  mimetype?: string;
  content?: string | Buffer;
} = {}) {
  const content = overrides.content ?? 'name,email\nJohn,john@test.com';
  const buffer = typeof content === 'string' ? Buffer.from(content) : content;

  return {
    filename: overrides.filename ?? 'test.csv',
    mimetype: overrides.mimetype ?? 'text/csv',
    encoding: '7bit',
    file: {
      // Make the file object an async iterable that yields the buffer
      [Symbol.asyncIterator]: async function* () {
        yield buffer;
      },
    },
  };
}

function createMockRequest(fileData: ReturnType<typeof createMockMultipartFile> | null = null) {
  return {
    user: {
      userId: 'user-1',
      tenantId: 'tenant-1',
      email: 'admin@test.com',
      role: 'ADMIN',
    },
    file: vi.fn().mockResolvedValue(fileData),
  } as any;
}

function createController() {
  const importService = createMockImportService();
  const controller = new (ImportController as any)(importService) as ImportController;
  return { controller, importService };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ImportController', () => {
  let controller: ImportController;
  let importService: ReturnType<typeof createMockImportService>;

  beforeEach(() => {
    ({ controller, importService } = createController());
  });

  describe('upload', () => {
    it('should reject when no file is uploaded', async () => {
      const req = createMockRequest(null);

      await expect(controller.upload(req)).rejects.toThrow(BadRequestException);
      await expect(controller.upload(req)).rejects.toThrow(
        'No file uploaded. Send a multipart form with a "file" field.',
      );
    });

    it('should reject non-CSV file extensions', async () => {
      const file = createMockMultipartFile({ filename: 'data.xlsx' });
      const req = createMockRequest(file);

      await expect(controller.upload(req)).rejects.toThrow(BadRequestException);
      await expect(controller.upload(req)).rejects.toThrow('Only CSV files are supported');
    });

    it('should reject .json file extensions', async () => {
      const file = createMockMultipartFile({ filename: 'data.json' });
      const req = createMockRequest(file);

      await expect(controller.upload(req)).rejects.toThrow(BadRequestException);
      await expect(controller.upload(req)).rejects.toThrow('Only CSV files are supported');
    });

    it('should reject .txt file extension (not .csv)', async () => {
      const file = createMockMultipartFile({ filename: 'report.txt' });
      const req = createMockRequest(file);

      await expect(controller.upload(req)).rejects.toThrow(BadRequestException);
      await expect(controller.upload(req)).rejects.toThrow('Only CSV files are supported');
    });

    it('should reject files with no extension', async () => {
      const file = createMockMultipartFile({ filename: 'noextension' });
      const req = createMockRequest(file);

      await expect(controller.upload(req)).rejects.toThrow(BadRequestException);
      await expect(controller.upload(req)).rejects.toThrow('Only CSV files are supported');
    });

    it('should reject invalid MIME types', async () => {
      const file = createMockMultipartFile({
        filename: 'data.csv',
        mimetype: 'application/json',
      });
      const req = createMockRequest(file);

      await expect(controller.upload(req)).rejects.toThrow(BadRequestException);
      await expect(controller.upload(req)).rejects.toThrow('Invalid file type. Expected text/csv');
    });

    it('should reject application/octet-stream MIME type', async () => {
      const file = createMockMultipartFile({
        filename: 'data.csv',
        mimetype: 'application/octet-stream',
      });
      const req = createMockRequest(file);

      await expect(controller.upload(req)).rejects.toThrow(BadRequestException);
      await expect(controller.upload(req)).rejects.toThrow('Invalid file type. Expected text/csv');
    });

    it('should reject empty files', async () => {
      const file = createMockMultipartFile({
        filename: 'empty.csv',
        mimetype: 'text/csv',
        content: '',
      });
      const req = createMockRequest(file);

      await expect(controller.upload(req)).rejects.toThrow(BadRequestException);
      await expect(controller.upload(req)).rejects.toThrow('Uploaded file is empty');
    });

    it('should accept valid CSV with text/csv MIME type', async () => {
      const csvContent = 'name,email\nJohn,john@test.com';
      const file = createMockMultipartFile({
        filename: 'employees.csv',
        mimetype: 'text/csv',
        content: csvContent,
      });
      const req = createMockRequest(file);

      const result = await controller.upload(req);

      expect(result).toEqual({
        id: 'import-1',
        status: 'REVIEW',
        fileName: 'test.csv',
        totalRows: 10,
      });
      expect(importService.upload).toHaveBeenCalledWith(
        'tenant-1',
        'user-1',
        'employees.csv',
        Buffer.from(csvContent),
      );
    });

    it('should accept valid CSV with application/csv MIME type', async () => {
      const file = createMockMultipartFile({
        filename: 'data.csv',
        mimetype: 'application/csv',
      });
      const req = createMockRequest(file);

      const result = await controller.upload(req);
      expect(importService.upload).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should accept valid CSV with text/plain MIME type', async () => {
      const file = createMockMultipartFile({
        filename: 'data.csv',
        mimetype: 'text/plain',
      });
      const req = createMockRequest(file);

      const result = await controller.upload(req);
      expect(importService.upload).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should handle filename case-insensitively (.CSV)', async () => {
      const file = createMockMultipartFile({
        filename: 'DATA.CSV',
        mimetype: 'text/csv',
      });
      const req = createMockRequest(file);

      const result = await controller.upload(req);
      expect(importService.upload).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should pass user context (tenantId, userId) to the service', async () => {
      const file = createMockMultipartFile({ filename: 'test.csv' });
      const req = createMockRequest(file);
      req.user.tenantId = 'tenant-xyz';
      req.user.userId = 'user-abc';

      await controller.upload(req);

      expect(importService.upload).toHaveBeenCalledWith(
        'tenant-xyz',
        'user-abc',
        'test.csv',
        expect.any(Buffer),
      );
    });

    it('should concatenate multiple chunks from file stream', async () => {
      const chunk1 = Buffer.from('name,email\n');
      const chunk2 = Buffer.from('John,john@test.com\n');
      const chunk3 = Buffer.from('Jane,jane@test.com');

      const file = {
        filename: 'multi-chunk.csv',
        mimetype: 'text/csv',
        encoding: '7bit',
        file: {
          [Symbol.asyncIterator]: async function* () {
            yield chunk1;
            yield chunk2;
            yield chunk3;
          },
        },
      };
      const req = createMockRequest(file);

      await controller.upload(req);

      const expectedBuffer = Buffer.concat([chunk1, chunk2, chunk3]);
      expect(importService.upload).toHaveBeenCalledWith(
        'tenant-1',
        'user-1',
        'multi-chunk.csv',
        expectedBuffer,
      );
    });
  });
});
