const path = require('path');
const fs = require('fs/promises');
const logger = require('../utils/logger');
const Pixal3dJob = require('../models/pixal3d_job');
const Pixal3dGatewayService = require('./pixal3dGatewayService');
const {
  buildGatewayErrorMessage,
  extractGenerationResponseMetadata,
} = require('./pixal3dGatewayService');
const {
  SUPPORTED_PIXAL3D_IMAGE_FORMATS,
  randomAssetFileName,
} = require('../utils/pixal3d');

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstFinite(...values) {
  for (const value of values) {
    const number = finiteOrNull(value);
    if (number !== null) return number;
  }
  return null;
}

function safeJobError(error) {
  const message = error?.statusCode
    ? error.message
    : buildGatewayErrorMessage(error, 'Pixal3D generation failed.');
  return String(message || 'Pixal3D generation failed.').slice(0, 1000);
}

function plainSubdocument(value) {
  return value && typeof value.toObject === 'function' ? value.toObject() : value;
}

function assertSafeFileName(fileName) {
  if (!fileName || path.basename(fileName) !== fileName || !/^[a-f0-9]{64}\.(?:jpg|png|webp|glb)$/.test(fileName)) {
    throw new Error('Stored Pixal3D file name is invalid.');
  }
  return fileName;
}

class Pixal3dJobService {
  constructor({
    JobModel = Pixal3dJob,
    gateway = new Pixal3dGatewayService(),
    publicRoot = path.join(__dirname, '..', 'public'),
  } = {}) {
    this.JobModel = JobModel;
    this.gateway = gateway;
    this.publicRoot = publicRoot;
    this.inputDirectory = path.join(publicRoot, 'img');
    this.outputDirectory = path.join(publicRoot, 'pixal3d-models');
    this.queue = [];
    this.queuedJobIds = new Set();
    this.draining = false;
  }

  async ensureStorageDirectories() {
    await Promise.all([
      fs.mkdir(this.inputDirectory, { recursive: true }),
      fs.mkdir(this.outputDirectory, { recursive: true }),
    ]);
  }

  inputPath(fileName) {
    return path.join(this.inputDirectory, assertSafeFileName(fileName));
  }

  outputPath(fileName) {
    return path.join(this.outputDirectory, assertSafeFileName(fileName));
  }

  async storeInputImage(buffer, format) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      const error = new Error('Choose an image to generate a 3D model.');
      error.statusCode = 400;
      throw error;
    }
    const formatInfo = SUPPORTED_PIXAL3D_IMAGE_FORMATS[format];
    if (!formatInfo) {
      const error = new Error('Use a PNG, JPEG, or WebP image.');
      error.statusCode = 400;
      throw error;
    }

    await this.ensureStorageDirectories();
    const fileName = randomAssetFileName(formatInfo.extension);
    await fs.writeFile(this.inputPath(fileName), buffer, { flag: 'wx' });
    return {
      fileName,
      publicUrl: `/img/${fileName}`,
      mimeType: formatInfo.mimeType,
    };
  }

  async removeInputImage(fileName) {
    if (!fileName) return;
    await fs.unlink(this.inputPath(fileName)).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  async removeOutputModel(fileName) {
    if (!fileName) return;
    await fs.unlink(this.outputPath(fileName)).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  async removeJobFiles(job) {
    const removals = await Promise.allSettled([
      this.removeInputImage(job?.inputImage?.fileName),
      this.removeOutputModel(job?.outputModel?.fileName),
    ]);
    const failedRemoval = removals.find((result) => result.status === 'rejected');
    if (failedRemoval) throw failedRemoval.reason;
  }

  enqueue(jobId) {
    const normalizedId = String(jobId || '');
    if (!normalizedId || this.queuedJobIds.has(normalizedId)) return;
    this.queuedJobIds.add(normalizedId);
    this.queue.push(normalizedId);
    void this.drainQueue();
  }

  async drainQueue() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        const jobId = this.queue.shift();
        try {
          await this.processJob(jobId);
        } catch (error) {
          logger.error('Unexpected Pixal3D queue error', {
            category: 'pixal3d_job',
            metadata: { jobId, message: error.message },
          });
        } finally {
          this.queuedJobIds.delete(jobId);
        }
      }
    } finally {
      this.draining = false;
      if (this.queue.length) void this.drainQueue();
    }
  }

  async processJob(jobId) {
    const startedAt = new Date();
    const job = await this.JobModel.findOneAndUpdate(
      { _id: jobId, status: 'queued' },
      { $set: { status: 'processing', startedAt, error: null } },
      { new: true },
    ).exec();
    if (!job) return;

    let outputFileName = null;
    let outputFilePath = null;
    try {
      await this.ensureStorageDirectories();
      await this.gateway.ensureContainerRunning();

      outputFileName = randomAssetFileName('.glb');
      outputFilePath = this.outputPath(outputFileName);
      const parameters = plainSubdocument(job.parameters);
      const result = await this.gateway.generateToFile({
        inputPath: this.inputPath(job.inputImage.fileName),
        inputFileName: job.inputImage.fileName,
        inputMimeType: job.inputImage.mimeType,
        outputPath: outputFilePath,
        parameters,
      });

      const responseMetadata = extractGenerationResponseMetadata(result.headers);
      let lastJob = null;
      try {
        const lastJobResponse = await this.gateway.getLastJob();
        const candidate = lastJobResponse?.last_job || lastJobResponse;
        if (responseMetadata.gatewayJobId && candidate?.job_id === responseMetadata.gatewayJobId) {
          lastJob = candidate;
        }
      } catch (metadataError) {
        logger.warning('Unable to load Pixal3D job metadata after generation', {
          category: 'pixal3d_job',
          metadata: {
            jobId,
            gatewayJobId: responseMetadata.gatewayJobId,
            message: buildGatewayErrorMessage(metadataError),
          },
        });
      }

      const generationSeconds = firstFinite(lastJob?.generation_seconds, responseMetadata.generationSeconds);
      const exportSeconds = firstFinite(lastJob?.export_seconds, responseMetadata.exportSeconds);
      const totalSeconds = firstFinite(
        lastJob?.total_seconds,
        generationSeconds !== null && exportSeconds !== null ? generationSeconds + exportSeconds : null,
      );

      await this.JobModel.updateOne({ _id: jobId }, {
        $set: {
          status: 'completed',
          completedAt: new Date(),
          error: null,
          gatewayJobId: responseMetadata.gatewayJobId || lastJob?.job_id || null,
          gatewayStatus: lastJob?.status || 'complete',
          outputModel: {
            fileName: outputFileName,
            publicUrl: `/pixal3d-models/${outputFileName}`,
            mimeType: responseMetadata.contentType || 'model/gltf-binary',
            sizeBytes: result.sizeBytes,
            glbVersion: result.version,
          },
          metrics: {
            generationSeconds,
            exportSeconds,
            totalSeconds,
            actualResolution: firstFinite(lastJob?.actual_resolution, responseMetadata.actualResolution),
            cameraSource: lastJob?.camera_source || null,
            cameraFovDegrees: firstFinite(lastJob?.camera_fov_degrees, responseMetadata.cameraFovDegrees),
            cameraDistance: finiteOrNull(lastJob?.camera_distance),
            peakAllocatedMiB: finiteOrNull(lastJob?.peak_allocated_mib),
            peakReservedMiB: firstFinite(lastJob?.peak_reserved_mib, responseMetadata.peakVramMiB),
            sourceVertices: finiteOrNull(lastJob?.source_vertices),
            sourceFaces: finiteOrNull(lastJob?.source_faces),
            inputMode: lastJob?.input_mode || null,
            workerRecycle: responseMetadata.workerRecycle,
          },
        },
      }).exec();

      logger.notice('Pixal3D job completed', {
        category: 'pixal3d_job',
        metadata: {
          jobId,
          gatewayJobId: responseMetadata.gatewayJobId,
          outputBytes: result.sizeBytes,
          totalSeconds,
        },
      });
    } catch (error) {
      if (outputFilePath) {
        await fs.unlink(outputFilePath).catch((unlinkError) => {
          if (unlinkError.code !== 'ENOENT') {
            logger.warning('Unable to remove failed Pixal3D model output', {
              category: 'pixal3d_job',
              metadata: { jobId, message: unlinkError.message },
            });
          }
        });
      }

      const message = safeJobError(error);
      await this.JobModel.updateOne({ _id: jobId }, {
        $set: {
          status: 'failed',
          error: message,
          completedAt: new Date(),
          outputModel: null,
        },
      }).exec();
      logger.warning('Pixal3D job failed', {
        category: 'pixal3d_job',
        metadata: {
          jobId,
          status: error?.response?.status || error?.statusCode || null,
          message,
        },
      });
    }
  }
}

module.exports = Pixal3dJobService;
module.exports.assertSafeFileName = assertSafeFileName;
module.exports.safeJobError = safeJobError;
