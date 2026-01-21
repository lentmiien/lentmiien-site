const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const SoundDataFolder = './public/mp3';
const ImageDataFolder = './public/img';
const { ArticleModel, Chat4Model, Conversation4Model, Chat4KnowledgeModel, FileMetaModel, AIModelCards } = require('../database');
const { tts, ig, GetOpenAIModels } = require('../utils/ChatGPT');
const { GetAnthropicModels } = require('../utils/anthropic');
const ScheduleTaskService = require('../services/scheduleTaskService');
const pdfUtils = require('../utils/pdf');
const EmbeddingApiService = require('../services/embeddingApiService');
const MessageService = require('../services/messageService');
const ConversationService = require('../services/conversationService');
const KnowledgeService = require('../services/knowledgeService');
const myLifeLogService = require('../services/myLifeLogService');

const messageService = new MessageService(Chat4Model, FileMetaModel);
const knowledgeService = new KnowledgeService(Chat4KnowledgeModel);
const conversationService = new ConversationService(Conversation4Model, messageService, knowledgeService);
const embeddingApiService = new EmbeddingApiService();
const fsp = fs.promises;
const EMBEDDING_SEARCH_TYPES = [
  { value: 'default', label: 'Fast (default)' },
  { value: 'high_quality', label: 'High-quality model' },
  { value: 'combined', label: 'Combined (rerank with high-quality)' },
];
const EMBEDDING_SEARCH_TYPE_MAP = EMBEDDING_SEARCH_TYPES.reduce((acc, option) => {
  acc[option.value] = option.label;
  return acc;
}, {});
const EMBEDDING_DEFAULT_SEARCH_TYPE = EMBEDDING_SEARCH_TYPES[0].value;
const EMBEDDING_SEARCH_DEFAULT_TOP_K = 50;
const EMBEDDING_SEARCH_MAX_TOP_K = 50;

function normalizePageSelection(input) {
  if (input === undefined || input === null) return [];
  const arr = Array.isArray(input) ? input : [input];
  const cleaned = [];
  arr.forEach((value) => {
    const parsed = parseInt(value, 10);
    if (!Number.isNaN(parsed) && parsed > 0 && cleaned.indexOf(parsed) === -1) {
      cleaned.push(parsed);
    }
  });
  return cleaned;
}

async function cleanupPromotedFiles(files = []) {
  if (!Array.isArray(files) || files.length === 0) return;
  await Promise.all(files.map(async (file) => {
    if (!file || !file.fileName) return;
    const absolute = path.join(__dirname, '../public/img', file.fileName);
    try {
      await fsp.unlink(absolute);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.warning('Unable to remove promoted PDF image after failure', { file: file.fileName, error: error.message });
      }
    }
  }));
}

function normalizeSearchType(raw) {
  const value = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (EMBEDDING_SEARCH_TYPE_MAP[value]) {
    return value;
  }
  return EMBEDDING_DEFAULT_SEARCH_TYPE;
}

function normalizeSearchForm(form = {}) {
  const query = typeof form?.query === 'string'
    ? form.query
    : typeof form?.search_text === 'string'
      ? form.search_text
      : typeof form?.searchText === 'string'
        ? form.searchText
        : '';
  const startDate = typeof form?.startDate === 'string'
    ? form.startDate
    : typeof form?.start_date === 'string'
      ? form.start_date
      : '';
  const endDate = typeof form?.endDate === 'string'
    ? form.endDate
    : typeof form?.end_date === 'string'
      ? form.end_date
      : '';
  const rawTopK = form?.topK ?? form?.top_k ?? form?.searchTopK ?? form?.search_top_k;
  const parsedTopK = Number.parseInt(rawTopK, 10);
  const topK = Number.isFinite(parsedTopK) && parsedTopK > 0
    ? Math.min(parsedTopK, EMBEDDING_SEARCH_MAX_TOP_K)
    : EMBEDDING_SEARCH_DEFAULT_TOP_K;
  const searchType = normalizeSearchType(form?.searchType ?? form?.search_type ?? form?.mode);

  return {
    query,
    topK,
    searchType,
    startDate,
    endDate,
  };
}

function buildSearchDateRange(startRaw, endRaw) {
  const parseDate = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return 'invalid';
    }
    return parsed;
  };

  const start = parseDate(startRaw);
  if (start === 'invalid') {
    return { error: 'Invalid start date. Please use YYYY-MM-DD.' };
  }
  const end = parseDate(endRaw);
  if (end === 'invalid') {
    return { error: 'Invalid end date. Please use YYYY-MM-DD.' };
  }

  if (start) {
    start.setUTCHours(0, 0, 0, 0);
  }
  if (end) {
    end.setUTCHours(23, 59, 59, 999);
  }

  if (start && end && start > end) {
    return { error: 'Start date must be before or equal to end date.' };
  }

  return { start, end };
}

function renderEmbeddingSearchPage(res, { searchForm, searchResult = null, searchError = null } = {}) {
  const normalizedForm = normalizeSearchForm(searchForm);
  const decoratedResult = searchResult
    ? {
        ...searchResult,
        modeLabel: searchResult.mode ? EMBEDDING_SEARCH_TYPE_MAP[searchResult.mode] || searchResult.mode : null,
      }
    : null;

  return res.render('embedding_search', {
    searchForm: normalizedForm,
    searchResult: decoratedResult,
    searchError,
    searchTypes: EMBEDDING_SEARCH_TYPES,
    searchTypeLabels: EMBEDDING_SEARCH_TYPE_MAP,
    searchLimits: {
      defaultTopK: EMBEDDING_SEARCH_DEFAULT_TOP_K,
      maxTopK: EMBEDDING_SEARCH_MAX_TOP_K,
    },
  });
}

async function handleEmbeddingSearch(req, res, formInput = {}, { requireQuery = false } = {}) {
  const searchForm = normalizeSearchForm(formInput);
  const query = (searchForm.query || '').trim();
  searchForm.query = query;

  if (!query) {
    if (requireQuery) {
      res.status(400);
      return renderEmbeddingSearchPage(res, { searchForm, searchError: 'Please enter text to search stored embeddings.' });
    }
    return renderEmbeddingSearchPage(res, { searchForm });
  }

  const dateRange = buildSearchDateRange(searchForm.startDate, searchForm.endDate);
  if (dateRange.error) {
    res.status(400);
    return renderEmbeddingSearchPage(res, { searchForm, searchError: dateRange.error });
  }

  const searchOptions = { topK: searchForm.topK, dateRange };

  try {
    let result;
    if (searchForm.searchType === 'high_quality') {
      result = await embeddingApiService.similaritySearchHighQuality(query, searchOptions);
    } else if (searchForm.searchType === 'combined') {
      result = await embeddingApiService.combinedSimilaritySearch(query, searchOptions);
    } else {
      result = await embeddingApiService.similaritySearch(query, searchOptions);
    }

    logger.notice('Embedding search completed', {
      category: 'embedding_search',
      metadata: {
        queryLength: query.length,
        topK: searchForm.topK,
        returned: result?.results?.length || 0,
        searchType: searchForm.searchType,
        mode: result?.mode || null,
        updatedAfter: dateRange.start ? dateRange.start.toISOString() : null,
        updatedBefore: dateRange.end ? dateRange.end.toISOString() : null,
      },
    });

    return renderEmbeddingSearchPage(res, { searchForm, searchResult: result });
  } catch (error) {
    const status = error?.status || 502;
    let message = error?.message || 'Unable to search embeddings.';

    if (error?.code === 'ETIMEOUT') {
      message = `Embedding search timed out after ${embeddingApiService.timeoutMs}ms.`;
    }

    logger.error('Embedding search failed', {
      category: 'embedding_search',
      metadata: {
        status: error?.status,
        code: error?.code,
        message: error?.message,
        searchType: searchForm.searchType,
      },
    });

    res.status(status);
    return renderEmbeddingSearchPage(res, { searchForm, searchError: message });
  }
}

exports.mypage = async (req, res) => {
  // Do something fun here, to show om mypage!
  const ts = Math.round((Date.now() - (1000 * 60 * 60 * 24 * 30)) / 1000);
  const OpenAI_models = GetOpenAIModels();
  const new_openai_models = OpenAI_models.filter(d => d.created > ts);
  const Anthropic_models = GetAnthropicModels();
  const new_anthropic_models = Anthropic_models.filter(d => d.created > ts);

  const modelCards = await AIModelCards.find({}, { provider: 1, api_model: 1 }).lean();
  const knownModels = new Set();
  modelCards.forEach((card) => {
    if (card.provider && card.api_model) {
      knownModels.add(`${card.provider.toLowerCase()}|${card.api_model.toLowerCase()}`);
    }
  });

  const decorateNewModels = (list, provider) => list.map((model) => {
    const modelName = typeof model.model === 'string' ? model.model : String(model.model || '');
    const key = `${provider.toLowerCase()}|${modelName.toLowerCase()}`;
    const existsInDb = knownModels.has(key);
    const manageUrl = existsInDb ? null : `/chat5/ai_model_cards?provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(modelName)}`;
    return {
      ...model,
      model: modelName,
      provider,
      existsInDb,
      manageUrl,
    };
  });

  const decoratedOpenAIModels = decorateNewModels(new_openai_models, 'OpenAI');
  const decoratedAnthropicModels = decorateNewModels(new_anthropic_models, 'Anthropic');

  const userId = req.user.name;
  const today = ScheduleTaskService.roundToSlot(new Date());
  const from = today;
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  const { presences, tasks } = await ScheduleTaskService.getTasksForWindow(userId, from, to);
  const lifeLogSuggestions = myLifeLogService.getLabelSuggestions(new Date());

  res.render('mypage', {
    new_openai_models: decoratedOpenAIModels,
    new_anthropic_models: decoratedAnthropicModels,
    tasks: tasks.filter((t) => !t.done && ((t.start && t.start < to) || !t.start)),
    embeddingSearchTypes: EMBEDDING_SEARCH_TYPES,
    embeddingSearchDefaultType: EMBEDDING_DEFAULT_SEARCH_TYPE,
    lifeLogSuggestions,
  });
};

exports.embedding_search_page = async (req, res) => handleEmbeddingSearch(req, res, req.query || {}, { requireQuery: false });

exports.embedding_search = async (req, res) => handleEmbeddingSearch(req, res, req.body || {}, { requireQuery: true });

exports.blogpost = async (req, res) => {
  const form_data = {
    id: "",
    title: "",
    category: "",
    content: "",
  };
  // if req.query.id then load from database and display page for editing entry
  if ("id" in req.query) {
    const entry = await ArticleModel.findById(req.query.id);
    if (entry) {
      form_data.id = req.query.id;
      form_data.title = entry.title;
      form_data.category = entry.category;
      form_data.content = entry.content.split('<br>').join('\n');
    }
  }
  // else display page for writuing a new entry
  res.render("blogpost", {form_data});
};

exports.post_blogpost = (req, res) => {
  // HTML form data, if id value is empty, then save new, otherwise update entry with the id
  if (req.body.id && req.body.id.length > 0) {
    // Update existing entry
    const Id = req.body.id;
    const update = {
      title: req.body.title,
      category: req.body.category,
      content: req.body.content.split('\n').join("<br>"),
      updated: new Date(),
    };

    ArticleModel.findByIdAndUpdate(Id, update, { new: true, useFindAndModify: false })
      .then((updatedArticle) => {
        res.redirect("/blog");
      })
      .catch((err) => logger.error('Error updating user:', err));
  } else {
    // New entry
    const entry_to_save = new ArticleModel({
      title: req.body.title,
      category: req.body.category,
      content: req.body.content.split('\n').join("<br>"),
      created: new Date(),
      updated: new Date(),
    });
  
    // Save to database
    entry_to_save.save().then((saved_data) => {
      setTimeout(() => res.redirect(`/blog`), 100);
    });
  }
};

exports.delete_blogpost = (req, res) => {
  // Delete blogpost with _id that is req.query.id
  ArticleModel.findByIdAndRemove(req.query.id).then(() => {
    setTimeout(() => res.redirect("/blog"), 100);
  });
};

exports.speektome = async (req, res) => {
  const file_list = fs.readdirSync(SoundDataFolder);
  res.render("speektome", { tts_file: (req.query.file ? `/mp3/${req.query.file}` : null), file_list });
};

exports.speektome_post = async (req, res) => {
  const file_list = fs.readdirSync(SoundDataFolder);
  const { filename } = await tts(req.body.model, req.body.text, req.body.voice);
  res.render("speektome", { tts_file: `/mp3/${filename}`, file_list });
};

exports.showtome = async (req, res) => {
  const file_list = fs.readdirSync(ImageDataFolder);
  res.render("showtome", { ig_file: (req.query.file ? `/img/${req.query.file}` : null), file_list });
};

exports.showtome_post = async (req, res) => {
  const file_list = fs.readdirSync(ImageDataFolder);
  const { filename } = await ig(req.body.prompt, req.body.quality, req.body.size);
  res.render("showtome", { ig_file: `/img/${filename}`, file_list });
};

exports.pdf_to_jpg = (req, res) => {
  res.render("pdf_to_jpg", { pageLimit: pdfUtils.getPageLimit() });
};

exports.convert_pdf_to_jpg = async (req, res) => {
  if (!req.file) {
    return res.status(400).render('pdf_to_jpg', { pageLimit: pdfUtils.getPageLimit(), error: 'Please provide a PDF file.' });
  }

  const uploadedPath = path.resolve(req.file.path || path.join(req.file.destination, req.file.filename));
  try {
    const manifest = await pdfUtils.convertPdfToImages({
      sourcePath: uploadedPath,
      originalName: req.file.originalname,
      owner: req.user ? req.user.name : null,
    });

    const imageUrls = manifest.images.map((img) => img.previewUrl);
    res.render("pdf_to_jpg_output", {
      imageUrls,
      pdfJob: manifest,
      pageLimit: pdfUtils.getPageLimit(),
      error: null,
      selectedPages: null,
      promptDraft: '',
    });
  } catch (error) {
    logger.error('Failed to convert PDF to JPG', { error: error.message });
    res.status(500).render('pdf_to_jpg', {
      pageLimit: pdfUtils.getPageLimit(),
      error: 'Something went wrong while converting your PDF. Please try again.',
    });
  } finally {
    fs.promises.unlink(uploadedPath).catch(() => {});
  }
};

exports.pdf_to_chat = async (req, res) => {
  const userId = req.user ? req.user.name : null;
  if (!userId) {
    return res.redirect('/login');
  }

  const jobId = typeof req.body.jobId === 'string' ? req.body.jobId.trim() : '';
  const selectedPages = normalizePageSelection(req.body.pages);
  const promptDraft = typeof req.body.prompt === 'string' ? req.body.prompt.trim() : '';

  if (!jobId) {
    return res.status(400).render('pdf_to_jpg', { pageLimit: pdfUtils.getPageLimit(), error: 'Missing PDF conversion job. Please upload your PDF again.' });
  }

  let manifest = null;
  let promotedFiles = [];

  if (selectedPages.length === 0) {
    manifest = await pdfUtils.loadJobManifest(jobId);
    const pageLimit = pdfUtils.getPageLimit();
    const imageUrls = manifest && manifest.images ? manifest.images.map((img) => img.previewUrl) : [];
    return res.status(400).render('pdf_to_jpg_output', {
      imageUrls,
      pdfJob: manifest,
      pageLimit,
      error: 'Select at least one page to continue.',
      selectedPages,
      promptDraft,
    });
  }

  try {
    const promotion = await pdfUtils.promoteJobPages(jobId, selectedPages, userId);
    manifest = promotion.manifest;
    promotedFiles = promotion.moved || [];
    if (!promotedFiles.length) {
      throw new Error('Select at least one page to continue.');
    }

    const baseTitle = manifest && manifest.pdfName ? manifest.pdfName.replace(/\.[^/.]+$/, '') : 'PDF Conversation';
    const conversation = await conversationService.createNewConversation(userId, undefined, {
      title: baseTitle,
      category: 'Chat5',
      tags: ['chat5', 'pdf'],
      members: [userId],
    });
    const conversationId = conversation._id.toString();

    const imageMessages = promotedFiles.map((entry) => ({
      fileName: entry.fileName,
      pageNumber: entry.pageNumber,
      revisedPrompt: `PDF upload page ${entry.pageNumber}`,
      imageQuality: 'high',
    }));

    await conversationService.postToConversationNew({
      conversationId,
      userId,
      messageContent: imageMessages,
      messageType: 'image',
      generateAI: false,
    });

    if (promptDraft.length > 0) {
      await conversationService.postToConversationNew({
        conversationId,
        userId,
        messageContent: {
          text: promptDraft,
          image: null,
          audio: null,
          tts: null,
          transcript: null,
          revisedPrompt: null,
          imageQuality: null,
          toolOutput: null,
        },
        messageType: 'text',
        generateAI: false,
      });
    }

    await pdfUtils.deleteJob(jobId);
    return res.redirect(`/chat5/chat/${conversationId}`);
  } catch (error) {
    await cleanupPromotedFiles(promotedFiles);
    logger.error('Failed to seed PDF pages into Chat5', { error: error.message });
    if (!manifest) {
      manifest = await pdfUtils.loadJobManifest(jobId);
    }
    const pageLimit = pdfUtils.getPageLimit();
    const imageUrls = manifest && manifest.images ? manifest.images.map((img) => img.previewUrl) : [];

    return res.status(400).render('pdf_to_jpg_output', {
      imageUrls,
      pdfJob: manifest,
      pageLimit,
      error: error.message || 'Unable to create a conversation from this PDF.',
      selectedPages,
      promptDraft,
    });
  }
};

/***********
 * TEST GitHub
 */
const GitHubService = require('../services/githubService');
const github = new GitHubService();
exports.github = async (req, res) => {
  const repos = await github.getRepoList();
  res.render("github", {repos});
};
exports.getfolder = async (req, res) => {
  const folder_content = await github.getRepositoryContents(req.query.repo);
  res.json(folder_content);
};
exports.updatefolder = async (req, res) => {
  const folder_content = await github.updateRepositoryContents(req.query.repo);
  res.json(folder_content);
};
exports.getfile = async (req, res) => {
  const file_content = await github.getFileContent(req.query.repo, req.query.path);
  res.json({data: file_content});
};
