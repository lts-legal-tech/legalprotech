README_FIX_COORDINATE_MODE.txt

Bản này thêm chế độ bắt tọa độ để xử lý UI Flow khi selector không bắt được.

Env nên thêm:
FLOW_COORDINATE_HELPER=true
FLOW_FORCE_COORDINATES=true

Sau đó chạy worker, trong Chrome Flow anh click thử vào từng điểm: model dropdown, option model, ô prompt, nút Generate.
Terminal worker sẽ in dạng: [FLOW_COORD] x=... y=...
Copy tọa độ đó vào .env.local:
FLOW_MODEL_CLICK_X=
FLOW_MODEL_CLICK_Y=
FLOW_MODEL_OPTION_CLICK_X=
FLOW_MODEL_OPTION_CLICK_Y=
FLOW_PROMPT_CLICK_X=
FLOW_PROMPT_CLICK_Y=
FLOW_GENERATE_CLICK_X=
FLOW_GENERATE_CLICK_Y=

Nếu cần aspect/duration:
FLOW_ASPECT_CLICK_X=
FLOW_ASPECT_CLICK_Y=
FLOW_ASPECT_OPTION_CLICK_X=
FLOW_ASPECT_OPTION_CLICK_Y=
FLOW_DURATION_CLICK_X=
FLOW_DURATION_CLICK_Y=
FLOW_DURATION_OPTION_CLICK_X=
FLOW_DURATION_OPTION_CLICK_Y=