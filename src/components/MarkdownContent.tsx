import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { isHttpReferenceUrl } from "../lib/reference-url";
import { remarkReferenceUrls } from "../lib/remark-reference-urls";

export const MarkdownContent = ({ children }: { children: string }) => (
  <div className="markdown-content">
    <Markdown
      remarkPlugins={[remarkGfm, remarkReferenceUrls]}
      skipHtml
      urlTransform={(url) => {
        const safe = defaultUrlTransform(url);
        return isHttpReferenceUrl(safe) || safe.startsWith("#") ? safe : undefined;
      }}
      components={{
        a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
        table: ({ node: _node, ...props }) => (
          <div className="markdown-table-scroll" role="region" aria-label="表格，可横向滚动" tabIndex={0}>
            <table {...props} />
          </div>
        ),
        code: ({ node: _node, className, children, ...props }) => (
          <code className={className} {...props}>{children}</code>
        )
      }}
    >
      {children}
    </Markdown>
  </div>
);
