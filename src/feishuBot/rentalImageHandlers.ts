import type { AgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import { createRentalPriceSkillClient, type RentalImagePickRequest, type RentalImageUploadRequest, type RentalPriceSkillClient } from './rentalPrice.js';
import type { BotResponse } from './types.js';

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireString(value: unknown, fieldName: string): string {
  const parsed = readString(value);
  if (!parsed) throw new Error(`${fieldName} is required`);
  return parsed;
}

function requireProductId(value: unknown, fieldName: string): string {
  const parsed = requireString(value, fieldName);
  if (!/^\d+$/.test(parsed)) throw new Error(`${fieldName} must be numeric`);
  return parsed;
}

function requireStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${fieldName} must be a non-empty array`);
  const items = value.map((item) => readString(item));
  if (items.some((item) => item === null)) throw new Error(`${fieldName} must contain only non-empty strings`);
  return items.filter((item): item is string => item !== null);
}

function requireRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${fieldName} must be an object`);
  return value as Record<string, unknown>;
}

function formatResult(title: string, result: { ok: boolean; status: string; lines: string[] }): string {
  return [`${title}: ${result.ok ? 'ok' : result.status}`, ...result.lines].join('\n');
}

export async function executeRentalImageTool(request: AgentToolConfirmRequest, rentalPriceClient?: RentalPriceSkillClient): Promise<BotResponse> {
  const client = rentalPriceClient ?? createRentalPriceSkillClient();
  switch (request.toolName) {
    case 'rental.imageRead': {
      if (!client.imageRead) return { text: '当前租赁客户端还没有接入图片读取能力。', metadata: { toolName: request.toolName, ok: false } };
      const productId = requireProductId(request.arguments.productId, 'productId');
      const result = await client.imageRead(productId);
      return { text: formatResult(`图片读取 ${productId}`, result), metadata: { toolName: request.toolName, ok: result.ok, productId, thumbCount: result.thumbs.length } };
    }
    case 'rental.imageUpload': {
      if (!client.imageUpload) return { text: '当前租赁客户端还没有接入图片上传能力。', metadata: { toolName: request.toolName, ok: false } };
      const upload: RentalImageUploadRequest = {
        productId: requireProductId(request.arguments.productId, 'productId'),
        sectionType: requireString(request.arguments.sectionType, 'sectionType'),
        categoryName: requireString(request.arguments.categoryName, 'categoryName'),
        uploadFile: requireString(request.arguments.uploadFile, 'uploadFile'),
        ...(request.arguments.confirmSelection !== undefined ? { confirmSelection: request.arguments.confirmSelection === true } : {}),
        ...(request.arguments.allowDuplicateFileName !== undefined ? { allowDuplicateFileName: request.arguments.allowDuplicateFileName === true } : {}),
      };
      const result = await client.imageUpload(upload);
      return { text: formatResult(`图片上传 ${upload.productId}`, result), metadata: { toolName: request.toolName, ok: result.ok, productId: upload.productId, status: result.status } };
    }
    case 'rental.imagePick': {
      if (!client.imagePick) return { text: '当前租赁客户端还没有接入图片选择能力。', metadata: { toolName: request.toolName, ok: false } };
      const pick: RentalImagePickRequest = {
        productId: requireProductId(request.arguments.productId, 'productId'),
        categoryName: requireString(request.arguments.categoryName, 'categoryName'),
        fileNames: requireStringArray(request.arguments.fileNames, 'fileNames'),
        ...(request.arguments.skipIfAlreadyPresent !== undefined ? { skipIfAlreadyPresent: request.arguments.skipIfAlreadyPresent === true } : {}),
      };
      const result = await client.imagePick(pick);
      return { text: formatResult(`图片选择 ${pick.productId}`, result), metadata: { toolName: request.toolName, ok: result.ok, productId: pick.productId, fileCount: pick.fileNames.length } };
    }
    case 'rental.imageOrder': {
      if (!client.imageOrder) return { text: '当前租赁客户端还没有接入图片排序能力。', metadata: { toolName: request.toolName, ok: false } };
      const productId = requireProductId(request.arguments.productId, 'productId');
      const orderedUrls = requireStringArray(request.arguments.orderedUrls, 'orderedUrls');
      const result = await client.imageOrder({ productId, orderedUrls });
      return { text: formatResult(`图片排序 ${productId}`, result), metadata: { toolName: request.toolName, ok: result.ok, productId, imageCount: orderedUrls.length } };
    }
    case 'rental.whiteImageSet': {
      if (!client.whiteImageSet) return { text: '当前租赁客户端还没有接入白底图设置能力。', metadata: { toolName: request.toolName, ok: false } };
      const productId = requireProductId(request.arguments.productId, 'productId');
      const result = await client.whiteImageSet({
        productId,
        categoryName: requireString(request.arguments.categoryName, 'categoryName'),
        fileName: requireString(request.arguments.fileName, 'fileName'),
        ...(request.arguments.skipIfWhiteImageMatched !== undefined ? { skipIfWhiteImageMatched: request.arguments.skipIfWhiteImageMatched === true } : {}),
      });
      return { text: formatResult(`白底图设置 ${productId}`, result), metadata: { toolName: request.toolName, ok: result.ok, productId } };
    }
    case 'rental.imageVerify': {
      if (!client.imageVerify) return { text: '当前租赁客户端还没有接入图片验证能力。', metadata: { toolName: request.toolName, ok: false } };
      const productId = requireProductId(request.arguments.productId, 'productId');
      const result = await client.imageVerify({ productId, expectedImages: requireRecord(request.arguments.expectedImages, 'expectedImages') });
      return { text: formatResult(`图片验证 ${productId}`, result), metadata: { toolName: request.toolName, ok: result.ok, productId } };
    }
    default:
      throw new Error(`Unsupported rental image tool: ${request.toolName}`);
  }
}
