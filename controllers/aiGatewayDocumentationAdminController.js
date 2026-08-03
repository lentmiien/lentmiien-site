const logger = require('../utils/logger');
const {
  AiGatewayDocumentationService,
  DEFAULT_GATEWAY_BASE_URL,
  DOCUMENTATION_APP_PATH,
  buildDocumentationLinks,
  extractDocumentationTitle,
  normalizeHttpBaseUrl,
  renderDocumentationMarkdown,
  sanitizeDocumentationFileName,
} = require('../services/aiGatewayDocumentationService');

const DEFAULT_PUBLIC_APP_BASE_URL = 'https://my.lentmiien.com';
const publicAppBaseUrl = normalizeHttpBaseUrl(
  process.env.PUBLIC_APP_BASE_URL,
  DEFAULT_PUBLIC_APP_BASE_URL,
);
const documentationService = new AiGatewayDocumentationService({
  gatewayBaseUrl: DEFAULT_GATEWAY_BASE_URL,
});

function buildFileViewModel(fileName) {
  return {
    name: fileName,
    href: `${DOCUMENTATION_APP_PATH}/${encodeURIComponent(fileName)}`,
  };
}

function gatewayErrorStatus(error) {
  if (error?.response?.status === 404) {
    return 404;
  }
  if (error?.code === 'ETIMEDOUT' || error?.code === 'ECONNABORTED') {
    return 504;
  }
  return 502;
}

function gatewayErrorMessage(error, fileName = null) {
  if (error?.response?.status === 404 && fileName) {
    return `Documentation file “${fileName}” was not found on the AI Gateway.`;
  }
  if (error?.code === 'ETIMEDOUT' || error?.code === 'ECONNABORTED') {
    return 'The AI Gateway documentation request timed out.';
  }
  return 'Unable to load documentation from the AI Gateway.';
}

function renderPage(res, viewModel, status = 200) {
  return res
    .status(status)
    .set('Cache-Control', 'no-store')
    .render('admin_ai_gateway_documentation', {
      files: [],
      selectedDoc: null,
      errorMessage: null,
      isDetail: false,
      gatewayBaseUrl: documentationService.gatewayBaseUrl,
      ...viewModel,
    });
}

exports.index = async (req, res) => {
  try {
    const fileNames = await documentationService.listFiles();
    return renderPage(res, {
      pageTitle: 'AI Gateway Documentation',
      files: fileNames.map(buildFileViewModel),
    });
  } catch (error) {
    const status = gatewayErrorStatus(error);
    logger.warning('Failed to load AI Gateway documentation list', {
      category: 'ai_gateway_documentation',
      metadata: {
        status,
        gatewayStatus: error?.response?.status || null,
        error: error?.message || String(error),
      },
    });

    return renderPage(res, {
      pageTitle: 'AI Gateway Documentation',
      errorMessage: gatewayErrorMessage(error),
    }, status);
  }
};

exports.show = async (req, res) => {
  const fileName = sanitizeDocumentationFileName(req.params.filename);
  if (!fileName) {
    return renderPage(res, {
      pageTitle: 'AI Gateway Documentation',
      isDetail: true,
      errorMessage: 'Invalid AI Gateway documentation filename.',
    }, 400);
  }

  try {
    const rawContent = await documentationService.fetchFile(fileName);
    const selectedDoc = {
      name: fileName,
      title: extractDocumentationTitle(rawContent, fileName),
      rawContent,
      contentHtml: renderDocumentationMarkdown(rawContent),
      links: buildDocumentationLinks({
        fileName,
        gatewayBaseUrl: documentationService.gatewayBaseUrl,
        publicAppBaseUrl,
      }),
    };

    return renderPage(res, {
      pageTitle: `${selectedDoc.title} - AI Gateway Documentation`,
      isDetail: true,
      selectedDoc,
    });
  } catch (error) {
    const status = gatewayErrorStatus(error);
    logger.warning('Failed to load AI Gateway documentation file', {
      category: 'ai_gateway_documentation',
      metadata: {
        fileName,
        status,
        gatewayStatus: error?.response?.status || null,
        error: error?.message || String(error),
      },
    });

    return renderPage(res, {
      pageTitle: `${fileName} - AI Gateway Documentation`,
      isDetail: true,
      errorMessage: gatewayErrorMessage(error, fileName),
    }, status);
  }
};
