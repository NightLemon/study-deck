import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

export const MarkdownContent = ({ children }: { children: string }) => (
  <div className="markdown-content">
    <Markdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      urlTransform={(url) => {
        const safe = defaultUrlTransform(url);
        return safe.startsWith("https://") || safe.startsWith("#") ? safe : "";
      }}
      components={{
        a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
        code: ({ node: _node, className, children, ...props }) => (
          <code className={className} {...props}>{children}</code>
        )
      }}
    >
      {children}
    </Markdown>
  </div>
);
