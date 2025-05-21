import formidable from 'formidable';
import fs from 'fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const form = new formidable.IncomingForm({ keepExtensions: true });

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: 'Error parsing form data' });

    const file = files.pdf;
    if (!file || !file.filepath) {
      return res.status(400).json({ error: 'No valid PDF uploaded' });
    }

    try {
      const dataBuffer = await fs.readFile(file.filepath);
      const pdf = await getDocument({ data: dataBuffer }).promise;
      let textContent = '';

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const strings = content.items.map(item => item.str);
        textContent += strings.join(' ') + '\n';
      }

      const text = textContent.slice(0, 7000);

      const openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout:free',
          messages: [
            {
              role: 'system',
              content: `You are the Green Message Guard – a professional assistant trained to detect greenwashing in marketing and communication texts. Your task is to identify, quote, and assess every environmental claim according to Directive (EU) 2024/825: Empowering Consumers for the Green Transition.\n\nFor each environmental claim you find:\n1. Quote the exact wording\n2. Give a traffic light rating (🟢 No Violation / 🟡 Potential Violation / 🔴 Violation)\n3. Justify the rating by checking:\n- Misleading environmental statements\n- Vague or unsubstantiated general claims\n- Sustainability labels lacking transparency\n- Irrelevant or trivial environmental benefits\n- Opaque product comparisons\n- Claims about meeting only minimum legal standards\n4. Make a recommendation: either improvement advice (🔴/🟡) or confirmation of compliance (🟢)\n\nIf a statement cannot be judged without more context, ask for clarification. Stay factual, constructive, and objective. Do not give legal advice.`
            },
            {
              role: 'user',
              content: text
            }
          ]
        })
      });

      const result = await openRouterResponse.json();
      const reply = result.choices?.[0]?.message?.content || 'No valid response.';
      return res.status(200).json({ analysis: reply });
    } catch (error) {
      console.error('Function crashed:', error);
      return res.status(500).json({ error: 'Server error while processing PDF' });
    }
  });
}
