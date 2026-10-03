import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Only validated citation buttons navigate to evidence. Model HTML, images and links
// cannot inject markup, load remote assets, or add unverified destinations.
export function MarkdownText({ text }: { text: string }) {
  return <div className="message-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml unwrapDisallowed allowedElements={['p', 'br', 'strong', 'em', 'del', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'hr', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td']}>{text}</Markdown></div>
}
