import React from 'react';
import Latex from 'react-latex-next';
import 'katex/dist/katex.min.css';

interface MathTextProps {
  text: string;
}

export default function MathText({ text }: MathTextProps) {
  if (!text) return null;
  
  // Replace \( \) with $ $ and \[ \] with $$ $$ for better KaTeX compatibility
  const processedText = text
    .replace(/\\\(/g, '$')
    .replace(/\\\)/g, '$')
    .replace(/\\\[/g, '$$$')
    .replace(/\\\]/g, '$$$');

  return (
    <div className="math-text text-gray-800 leading-relaxed whitespace-pre-wrap">
      <Latex>{processedText}</Latex>
    </div>
  );
}
