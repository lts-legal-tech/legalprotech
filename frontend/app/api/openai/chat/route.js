import { NextResponse } from 'next/server';

const MODEL = process.env.OPENAI_MODEL || 'gpt-5.4';

function extractText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const texts = [];
  const outputItems = Array.isArray(data?.output) ? data.output : [];

  for (const item of outputItems) {
    const contents = Array.isArray(item?.content) ? item.content : [];
    for (const content of contents) {
      if ((content?.type === 'output_text' || content?.type === 'text') && typeof content?.text === 'string') {
        texts.push(content.text);
      }
    }
  }

  return texts.join('\n').trim();
}

function getModeInstruction(mode) {
  switch (mode) {
    case 'script':
      return 'Bạn là strategist nội dung. Hãy phân tích brief và trả ra cấu trúc nội dung rõ, thực dụng, có opening angle, nội dung chính, CTA và gợi ý triển khai.';
    case 'image_prompt':
      return 'Bạn là chuyên gia viết prompt tạo ảnh thương mại. Hãy trả prompt tiếng Anh chất lượng cao, rõ subject, bối cảnh, ánh sáng, phong cách, framing, chất liệu, camera feel và negative constraints khi cần.';
    case 'video_script':
      return 'Bạn là chuyên gia viết kịch bản video ngắn phục vụ quảng cáo và social. Hãy trả ra hook, nhịp cảnh, lời thoại hoặc voice over, text on screen nếu cần và CTA cuối.';
    case 'shot_list':
      return 'Bạn là đạo diễn nội dung AI. Hãy chuyển brief thành shot list rõ ràng theo từng cảnh, gồm mục tiêu cảnh, framing, hành động, chuyển động máy, đạo cụ và ghi chú production.';
    case 'prompt':
    default:
      return 'Bạn là chuyên gia tối ưu prompt cho AI image và AI video. Hãy trả lời bằng tiếng Việt rõ, sắc, thực dụng; khi hợp lý có thể tạo prompt tiếng Anh sẵn để copy dùng ngay.';
  }
}

export async function POST(request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ success: false, error: 'Thiếu OPENAI_API_KEY trong môi trường server.' }, { status: 500 });
    }

    const { mode = 'prompt', project, messages = [], message = '' } = await request.json();
    const latestUser = [...messages].reverse().find((item) => item.role === 'user');
    const latestText = message || latestUser?.content || '';

    const context = [
      `Tên dự án: ${project?.name || 'Dự án mặc định'}`,
      `Loại dự án: ${project?.type || 'prompt'}`,
      `Chế độ: ${mode}`,
      latestText ? `Yêu cầu mới nhất: ${latestText}` : '',
      'Nếu cần trình bày theo cấu trúc, hãy dùng tiêu đề ngắn, rõ, có thể in đậm bằng cú pháp **text** cho những ý quan trọng.',
    ]
      .filter(Boolean)
      .join('\n');

    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: getModeInstruction(mode) }] },
          { role: 'user', content: [{ type: 'input_text', text: context }] },
        ],
      }),
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      return NextResponse.json({ success: false, error: data?.error?.message || 'OpenAI trả lỗi.' }, { status: upstream.status });
    }

    const text = extractText(data);

    return NextResponse.json({
      success: true,
      text,
      raw: data,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Không gọi được OpenAI.' }, { status: 500 });
  }
}
