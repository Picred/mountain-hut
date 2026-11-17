import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const components = {
    ul: ({ children }) => <ul className="my-2 list-disc pl-6">{children}</ul>,
    ol: ({ children }) => <ol className="my-2 list-decimal pl-6">{children}</ol>,
    li: ({ children }) => <li className="my-1">{children}</li>,
};

/**
 * Renders a slot menu written in Markdown (bold, italic, nested lists).
 */
export const MenuMarkdown = ({ menu }) => (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {menu}
    </ReactMarkdown>
);

export default MenuMarkdown;
