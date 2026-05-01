const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const audioWorkflowService = require('../services/audioWorkflowInstance');
const ToolManagerService = require('../services/toolManagerService');

const toolManagerService = new ToolManagerService();
const PUBLIC_MP3_DIR = path.resolve(__dirname, '..', 'public', 'mp3');

function buildFeedback(query = {}) {
  if (!query.status && !query.message) return null;
  return {
    status: query.status || 'info',
    message: query.message || '',
  };
}

function redirectWithFeedback(res, status, message, suffix = '') {
  const params = new URLSearchParams({ status, message });
  res.redirect(`/admin/audio-workflow${suffix}?${params.toString()}`);
}

function normalizeFormArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

exports.uploadAudio = async (req, res) => {
  try {
    const file = req.file;
    if (!file || !file.buffer) {
      return res.status(400).json({ error: 'Please upload an audio file in the `audio` field.' });
    }

    const job = await audioWorkflowService.enqueueUpload({
      file,
      fields: req.body || {},
      user: req.user || null,
    });

    return res.status(202).json({ job_id: job.job_id });
  } catch (error) {
    logger.error('Failed to enqueue audio workflow upload', {
      category: 'audio_workflow_api',
      metadata: { message: error?.message || error },
    });
    return res.status(500).json({ error: error?.message || 'Unable to enqueue audio workflow job.' });
  }
};

exports.getJob = async (req, res) => {
  try {
    const job = await audioWorkflowService.getJobStatus(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Audio workflow job not found.' });
    }
    return res.json({
      status: job.status,
      transcribed_text: job.transcribed_text || '',
      detected_language: job.detected_language || null,
      output_audio_id: job.output_audio_id || null,
      error: job.error || null,
      job_id: job.job_id,
    });
  } catch (error) {
    logger.error('Failed to fetch audio workflow job', {
      category: 'audio_workflow_api',
      metadata: { jobId: req.params.jobId, message: error?.message || error },
    });
    return res.status(500).json({ error: 'Unable to fetch audio workflow job.' });
  }
};

exports.getOutputAudio = async (req, res) => {
  try {
    const output = await audioWorkflowService.getOutputAudio(req.params.outputAudioId);
    if (!output) {
      return res.status(404).json({ error: 'Output audio not found.' });
    }

    const resolvedPath = path.resolve(output.filePath);
    if (!resolvedPath.startsWith(PUBLIC_MP3_DIR + path.sep) && resolvedPath !== PUBLIC_MP3_DIR) {
      return res.status(400).json({ error: 'Invalid output audio path.' });
    }

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'Output audio file is missing.' });
    }

    res.type(output.mimeType || 'audio/wav');
    return res.download(resolvedPath, output.fileName || 'output.wav');
  } catch (error) {
    logger.error('Failed to fetch audio workflow output', {
      category: 'audio_workflow_api',
      metadata: { outputAudioId: req.params.outputAudioId, message: error?.message || error },
    });
    return res.status(500).json({ error: 'Unable to fetch output audio.' });
  }
};

exports.renderAdmin = async (req, res) => {
  try {
    const [jobs, triggers, availableTools] = await Promise.all([
      audioWorkflowService.listJobs({ limit: req.query.limit || 50 }),
      audioWorkflowService.listTriggers(),
      toolManagerService.getAvailableTools(),
    ]);
    const editTrigger = req.query.edit ? await audioWorkflowService.getTrigger(req.query.edit) : null;
    const languageDefaultTtsVoices = audioWorkflowService.getDefaultTtsVoicesByLanguage();

    return res.render('admin_audio_workflow', {
      jobs,
      triggers,
      editTrigger,
      availableTools,
      languageDefaultTtsVoices,
      feedback: buildFeedback(req.query),
      defaultTrigger: {
        enabled: true,
        shouldInclude: [],
        shouldNotInclude: [],
        systemPrompt: 'You are a concise voice assistant. Answer the user based on the transcript.',
        messagePrompt: '{{transcript}}',
        llmModel: process.env.AUDIO_WORKFLOW_LLM_MODEL || 'gpt-5.5',
        reasoning: 'medium',
        verbosity: 'medium',
        outputFormat: 'text',
        tools: [],
        ttsEnabled: true,
        ttsVoiceId: process.env.AUDIO_WORKFLOW_TTS_VOICE || '',
        ttsFormat: process.env.AUDIO_WORKFLOW_TTS_FORMAT || 'wav',
        sortOrder: 0,
      },
    });
  } catch (error) {
    logger.error('Failed to render audio workflow admin page', {
      category: 'audio_workflow_admin',
      metadata: { message: error?.message || error },
    });
    return res.status(500).render('error_page', { error: 'Unable to load audio workflow admin page.' });
  }
};

exports.saveTrigger = async (req, res) => {
  try {
    const body = req.body || {};
    await audioWorkflowService.saveTrigger({
      ...body,
      shouldInclude: body.shouldInclude,
      shouldNotInclude: body.shouldNotInclude,
      tools: normalizeFormArray(body.tools),
    }, req.user?.name || 'admin');
    return redirectWithFeedback(res, 'success', 'Trigger saved.');
  } catch (error) {
    logger.error('Failed to save audio workflow trigger', {
      category: 'audio_workflow_admin',
      metadata: { message: error?.message || error },
    });
    return redirectWithFeedback(res, 'error', error?.message || 'Unable to save trigger.');
  }
};

exports.toggleTrigger = async (req, res) => {
  try {
    await audioWorkflowService.toggleTrigger(req.params.id, req.body?.enabled);
    return redirectWithFeedback(res, 'success', 'Trigger updated.');
  } catch (error) {
    logger.error('Failed to toggle audio workflow trigger', {
      category: 'audio_workflow_admin',
      metadata: { triggerId: req.params.id, message: error?.message || error },
    });
    return redirectWithFeedback(res, 'error', error?.message || 'Unable to update trigger.');
  }
};

exports.deleteTrigger = async (req, res) => {
  try {
    await audioWorkflowService.deleteTrigger(req.params.id);
    return redirectWithFeedback(res, 'success', 'Trigger deleted.');
  } catch (error) {
    logger.error('Failed to delete audio workflow trigger', {
      category: 'audio_workflow_admin',
      metadata: { triggerId: req.params.id, message: error?.message || error },
    });
    return redirectWithFeedback(res, 'error', error?.message || 'Unable to delete trigger.');
  }
};
