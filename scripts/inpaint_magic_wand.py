import gradio as gr

from modules import scripts


PANEL_HTML = """
<div id="inpaint_magic_wand_panel" class="imw-panel">
    <div class="imw-row imw-row-top">
        <label class="imw-check">
            <input id="imw_enabled" type="checkbox">
            <span>Enable click selection</span>
        </label>
        <label>
            <span>Mode</span>
            <select id="imw_mode">
                <option value="replace" selected>Replace</option>
                <option value="add">Add</option>
                <option value="subtract">Subtract</option>
                <option value="intersect">Intersect</option>
            </select>
        </label>
        <label class="imw-check">
            <input id="imw_contiguous" type="checkbox" checked>
            <span>Contiguous</span>
        </label>
    </div>
    <div class="imw-grid">
        <label>
            <span>Tolerance</span>
            <input id="imw_tolerance" type="range" min="0" max="255" step="1" value="32">
            <output id="imw_tolerance_value">32</output>
        </label>
        <label>
            <span>Grow pixels</span>
            <input id="imw_grow" type="range" min="0" max="64" step="1" value="2">
            <output id="imw_grow_value">2</output>
        </label>
    </div>
    <div class="imw-row imw-actions">
        <button id="imw_clear" type="button">Clear mask</button>
        <button id="imw_invert" type="button">Invert mask</button>
        <span id="imw_status" role="status">Idle</span>
    </div>
</div>
"""


class Script(scripts.Script):
    sorting_priority = 17

    def title(self):
        return "Magic Wand Integrated"

    def show(self, is_img2img):
        return scripts.AlwaysVisible if is_img2img else False

    def ui(self, is_img2img):
        if not is_img2img:
            return []

        with gr.Accordion(
            open=False,
            label=self.title(),
            elem_id="img2img_magic_wand_integrated",
            elem_classes=["inpaint-magic-wand-integrated"],
        ):
            gr.HTML(PANEL_HTML, elem_id="inpaint_magic_wand_html")

        return []
