"""Font files and timed title subtitles for FFmpeg/libass."""
import textwrap
from pathlib import Path

FONT_DIR = Path(__file__).parent / 'assets' / 'fonts' / 'editor'
FONTS = {
    'inter': ('Inter', 'Inter_700Bold.ttf', True),
    'montserrat': ('Montserrat', 'Montserrat_700Bold.ttf', True),
    'space-grotesk': ('Space Grotesk', 'SpaceGrotesk_700Bold.ttf', True),
    'bebas': ('Bebas Neue', 'BebasNeue_400Regular.ttf', False),
    'anton': ('Anton', 'Anton_400Regular.ttf', False),
    'archivo-black': ('Archivo Black', 'ArchivoBlack_400Regular.ttf', False),
    'fraunces': ('Fraunces', 'Fraunces_400Regular.ttf', False),
    'playfair': ('Playfair Display', 'PlayfairDisplay_400Regular.ttf', False),
    'dm-serif': ('DM Serif Display', 'DMSerifDisplay_400Regular.ttf', False),
    'caveat': ('Caveat', 'Caveat_400Regular.ttf', False),
    'marker': ('Permanent Marker', 'PermanentMarker_400Regular.ttf', False),
}
ALIASES = {'sans': 'inter', 'bold': 'montserrat', 'mono': 'space-grotesk', 'serif': 'playfair',
           'serif_bold': 'fraunces', 'condensed': 'bebas'}


def font_info(font_id):
    return FONTS.get(ALIASES.get(font_id, font_id), FONTS['inter'])


def wrap_text(text, font_size, max_width, lines=3):
    columns = max(8, int(max_width / (font_size * 0.58)))
    wrapped = textwrap.wrap(' '.join(text.split()), columns, break_long_words=True, break_on_hyphens=False)
    if len(wrapped) > lines:
        wrapped = wrapped[:lines]
        wrapped[-1] = wrapped[-1].rstrip('. ') + '…'
    return '\n'.join(wrapped)


def _time(value):
    centiseconds = round(value * 100)
    return f'{centiseconds // 360000}:{centiseconds // 6000 % 60:02}:{centiseconds // 100 % 60:02}.{centiseconds % 100:02}'


def _safe_text(text):
    return text.replace('\\', '＼').replace('{', '｛').replace('}', '｝').replace('\n', r'\N')


def write_title(path, width, height, text, font_id, size, color, position, animation):
    family, _, bold = font_info(font_id)
    font_size = round(min(width, height) * {'small': .042, 'medium': .058, 'large': .074}.get(size, .058))
    text = wrap_text(text, font_size, width * .9, 2)
    colors = {'white': 'FFFFFF', 'gold': '69C8F5', 'pink': '5F11E0', 'black': '141110'}
    text_color = '&H00' + colors.get(color, 'FFFFFF')
    background = '&H40FFFFFF' if color == 'black' else '&HB8000000'
    x, y = round(width / 2), round(height * {'top': .15, 'center': .5, 'bottom': .84}.get(position, .84))
    lines = [f'''[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 2
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,{family},{font_size},{text_color},{text_color},{background},{background},{-1 if bold else 0},0,0,0,100,100,0,0,3,{max(2, round(width*.012))},0,5,0,0,0,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text''']
    position_tag = f'\\pos({x},{y})'
    if animation == 'slide-up':
        position_tag = f'\\move({x},{y+round(height*.032)},{x},{y},0,450)\\fad(450,0)'
    elif animation == 'fade':
        position_tag += r'\fad(450,0)'
    elif animation == 'pop':
        position_tag += r'\fscx65\fscy65\t(0,450,\fscx100\fscy100)\fad(100,0)'
    if animation in {'typewriter', 'word-by-word'}:
        parts = list(text) if animation == 'typewriter' else text.split(' ')
        separator = '' if animation == 'typewriter' else ' '
        events = [(i * .45 / len(parts), (i + 1) * .45 / len(parts) if i < len(parts)-1 else 3.5,
                   separator.join(parts[:i+1])) for i in range(len(parts))]
    else:
        events = [(0, 3.5, text)]
    for start, end, value in events:
        lines.append(f'Dialogue: 0,{_time(start)},{_time(end)},Title,,0,0,0,,{{{position_tag}}}{_safe_text(value)}')
    path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
