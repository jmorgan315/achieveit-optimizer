type ErrorContext = 'upload' | 'extraction' | 'suggestion' | 'vision' | 'general';

export function getUserFriendlyError(error: unknown, context: ErrorContext): string {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  // Rate limit
  if (lowerMessage.includes('rate limit') || lowerMessage.includes('429') || lowerMessage.includes('too many')) {
    return "We're processing too many requests right now. Please wait about 30 seconds and try again.";
  }

  // Credits exhausted
  if (lowerMessage.includes('credits') || lowerMessage.includes('402')) {
    return 'AI credits have been exhausted. Please add credits to continue.';
  }

  // Context-specific messages
  switch (context) {
    case 'upload':
      if (lowerMessage.includes('parse') || lowerMessage.includes('pdf')) {
        return "We couldn't read your PDF. The file may be corrupted or password-protected. Try re-saving it or using a different format.";
      }
      if (lowerMessage.includes('read file')) {
        return "We couldn't read your file. Please make sure it's not corrupted and try again.";
      }
      return "Something went wrong while processing your file. Please try again, or try a different file format.";

    case 'extraction':
      if (lowerMessage.includes('no data') || lowerMessage.includes('returned no')) {
        return "Our AI wasn't able to find any plan items in your document. This can happen with unusual formatting. Try copying the text into a plain text file and uploading that instead.";
      }
      return "Our AI wasn't able to understand the document structure. This can happen with unusual formatting. Try copying the text into a plain text file and uploading that instead.";

    case 'vision':
      if (lowerMessage.includes('no data') || lowerMessage.includes('returned no')) {
        return "Our Vision AI couldn't identify plan items from the document images. Try uploading a cleaner scan or a text-based PDF instead.";
      }
      return "Our Vision AI had trouble analyzing your document. Try re-saving it as a cleaner PDF or using a different format.";

    case 'suggestion':
      return "We couldn't generate a metric suggestion right now. This is usually temporary — please try again in a moment.";

    default:
      return "Something unexpected went wrong. Please try again, and if the problem continues, try a different file format or contact support.";
  }
}
