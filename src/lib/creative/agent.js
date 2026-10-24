// Flows agent: a chat assistant that edits the canvas. The real ElevenLabs
// agent drives the flow through operations such as add_node, add_edges,
// update_node, remove_elements, add_group and run_nodes (observed in the
// shipped bundle). Here a MiniMax chat model plans those operations as JSON
// and the page applies them.

import { NODE_TYPES } from './catalog.js';
import { selectedOutput } from './store.js';
import { chat } from '../minimax.js';

function registry() {
    return Object.entries(NODE_TYPES)
        .filter(([type, d]) => !d.decor && type !== 'asset')
        .map(([type, d]) => ({
            type,
            label: d.label,
            output: d.output,
            inputs: d.inputs.map(p => `${p.key}(${p.accepts.join('|')}${p.multi ? ', many' : ''})`),
            models: d.models.map(m => m.id),
            params: d.params.filter(p => p.type !== 'voice').map(p => p.options ? `${p.name}: ${p.options.filter(o => o !== '').join('|')}` : `${p.name}: ${p.type}`),
        }));
}

function flowState(flow) {
    return {
        nodes: flow.nodes.map(n => ({
            id: n.id, type: n.type, label: n.label, model: n.model,
            prompt: n.prompt ? n.prompt.slice(0, 300) : undefined,
            params: n.params, x: n.x, y: n.y,
            has_result: !!selectedOutput(n), status: n.run?.status,
        })),
        edges: flow.edges.map(e => ({ from: e.from, to: e.to, port: e.toPort })),
    };
}

const SYSTEM = `You are the Flows agent of a node-based creative canvas. You build and edit flows of generation nodes for the user.

Reply with ONE JSON object and nothing else:
{"reply": "<short answer for the user>", "ops": [<operations>]}

Operations:
- {"op":"add_node","ref":"<new id you choose, e.g. n1>","type":"<node type>","label":"...","prompt":"...","model":"<model id>","params":{...},"x":<number>,"y":<number>}
- {"op":"add_edges","edges":[{"from":"<node id or ref>","to":"<node id or ref>","port":"<input port key>"}]}
- {"op":"update_node","id":"<node id>","label":"...","prompt":"...","model":"...","params":{...}}
- {"op":"remove_elements","ids":["<node id>", ...]}
- {"op":"add_group","label":"...","ids":["<node id or ref>", ...]}
- {"op":"run_nodes","ids":["<node id or ref>", ...]}

Rules:
- Only use node types, ports, models and parameter values from the registry.
- An edge carries the source node's output modality and must enter a port that accepts it.
- Text nodes hold fixed text in "prompt". Generation prompts are written in English, concrete and visual.
- Lay new nodes out left to right: about 340 px between columns and 360 px between rows, starting to the right of existing nodes.
- Only add run_nodes when the user asks to generate or run. Never invent node ids: use ids from the flow state or refs you created.
- If the request is a question, answer it with an empty ops list.`;

export async function askAgent(flow, history, message) {
    const context = `Node registry:\n${JSON.stringify(registry())}\n\nCurrent flow state:\n${JSON.stringify(flowState(flow))}`;
    const messages = [
        { role: 'system', content: `${SYSTEM}\n\n${context}` },
        ...history.slice(-12).map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: message },
    ];
    const text = await chat({ model: 'MiniMax-M2', messages, temperature: 0.3 });
    return parseReply(text);
}

export function parseReply(text) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try {
            const obj = JSON.parse(text.slice(start, end + 1));
            return { reply: String(obj.reply || ''), ops: Array.isArray(obj.ops) ? obj.ops : [] };
        } catch { /* fall through to plain text */ }
    }
    return { reply: text, ops: [] };
}
