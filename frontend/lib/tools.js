export const TOOL_LIST = [
  {
    slug: 'text-to-image',
    label: 'Text to Image',
    shortLabel: 'Tạo ảnh từ prompt',
    inputMode: 'text',
    outputType: 'image',
    useFlow: true,
    description:
      'Tạo ảnh quảng cáo, visual social, poster hoặc concept từ prompt. Luồng này chạy qua Windows VPS AutoFlow, tự dùng Nano Banana Pro trên Flow và trả ảnh về website.',
    defaults: {
      prompt:
        'Premium skincare bottle on reflective surface, soft spotlight, minimal luxury set, ad-ready composition.',
      model: 'nano-banana-pro',
      aspectRatio: '16:9',
      count: '1',
    },
    models: [
      { id: 'nano-banana-pro', label: 'Nano Banana Pro' },
    ],
    expectedCount: 4,
    iconName: 'image',
  },
  {
    slug: 'text-to-video',
    label: 'Text to Video',
    shortLabel: 'Tạo video từ prompt',
    inputMode: 'text',
    outputType: 'video',
    description:
      'Luồng video chạy qua Windows VPS Worker. User tạo job trên web, Worker mở Flow, chọn model, nhập prompt và trả kết quả về website.',
    defaults: {
      prompt:
        'Luxury skincare commercial, cinematic lighting, smooth camera move, clean premium set, elegant hand interaction.',
      model: 'veo-3.1-fast-lower-priority',
      aspectRatio: '16:9',
      duration: '8',
      videosPerPrompt: '1',
    },
    models: [
      { id: 'veo-3.1-fast-lower-priority', label: 'Veo 3.1 Fast (lower priority - leaving 5/10)' },
      { id: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast' },
      { id: 'veo-3.1-generate-preview', label: 'Veo 3.1 Standard' },
    ],
    expectedCount: 10,
    iconName: 'video',
  },
  {
    slug: 'image-to-video',
    label: 'Image to Video',
    shortLabel: 'Biến ảnh thành video',
    inputMode: 'image+text',
    outputType: 'video',
    description:
      'Luồng image-to-video chạy qua Windows VPS Worker. Website gửi ảnh điểm đầu/điểm cuối và prompt, Worker mở Flow, chọn đúng model Veo 3.1 Fast (lower priority - leaving 5/10), upload frame và trả video về website.',
    defaults: {
      prompt:
        'Add subtle camera dolly-in, glossy reflections, premium movement, elegant motion design.',
      model: 'veo-3.1-fast-lower-priority',
      aspectRatio: '16:9',
      duration: '8',
      videosPerPrompt: '1',
    },
    models: [
      { id: 'veo-3.1-fast-lower-priority', label: 'Veo 3.1 Fast (lower priority - leaving 5/10)' },
      { id: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast' },
      { id: 'veo-3.1-generate-preview', label: 'Veo 3.1 Standard' },
    ],
    expectedCount: 10,
    iconName: 'wand',
  },
  {
    slug: 'my-product',
    label: 'My Product',
    shortLabel: 'Ảnh và video cho sản phẩm của tôi',
    inputMode: 'image+text',
    outputType: 'image',
    description:
      'Tải ảnh sản phẩm, chọn hướng triển khai rồi tạo bộ visual thương mại phục vụ listing, social, ads hoặc shot studio. Route này đóng vai trò workspace sản phẩm tổng hợp.',
    defaults: {
      prompt:
        'Clean studio setup, soft white light, polished commercial e-commerce aesthetic, premium ad-ready background.',
      model: 'gemini-3.1-flash-image-preview',
      aspectRatio: '1:1',
      count: '4',
    },
    models: [
      { id: 'gemini-3.1-flash-image-preview', label: 'Google Image Fast' },
      { id: 'imagen-4', label: 'Imagen 4' },
    ],
    expectedCount: 4,
    iconName: 'box',
  },
];

export function getToolBySlug(slug) {
  return TOOL_LIST.find((x) => x.slug === slug) || TOOL_LIST[0];
}

export const CHATBOT_PROJECT_SEED = [
  { id: 'proj-01', name: 'Dự án prompt mỹ phẩm', type: 'prompt' },
  { id: 'proj-02', name: 'Kịch bản video launch', type: 'script' },
  { id: 'proj-03', name: 'Prompt nhân vật cố định', type: 'prompt' },
  { id: 'proj-04', name: 'Ý tưởng banner social', type: 'prompt' },
  { id: 'proj-05', name: 'Kịch bản ads 15s', type: 'script' },
  { id: 'proj-06', name: 'Storyboard hook sản phẩm', type: 'script' },
  { id: 'proj-07', name: 'Prompt sản phẩm premium', type: 'prompt' },
];
