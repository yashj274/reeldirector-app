"""Apply the web preview's CSS filter operations in RGB when exporting."""
import math
import re

# These values mirror FILTERS in the editor; a regression test checks them together.
CSS_FILTERS = {
    'warm': 'sepia(0.16) saturate(1.12)', 'cool': 'hue-rotate(9deg) saturate(1.06)',
    'mono': 'grayscale(1) contrast(1.04)', 'vivid': 'saturate(1.22) contrast(1.08)',
    'vintage': 'sepia(0.24) saturate(0.8) contrast(0.92)', 'soft': 'saturate(0.92) contrast(0.92)',
    'film': 'sepia(0.12) saturate(0.88) contrast(0.96)',
    'cinematic': 'contrast(1.08) saturate(0.9)', 'luxury': 'contrast(1.08) saturate(0.94)',
    'editorial': 'contrast(1.06) saturate(0.86)', 'action': 'contrast(1.12) saturate(1.12)',
    'fast_pace': 'contrast(1.08) saturate(1.12)', 'minimal': 'saturate(0.85)',
}


def brightness(value):
    expression = f"clip(val*{value:.5f},0,255)"
    return 'lutrgb=' + ':'.join(f"{channel}='{expression}'" for channel in 'rgb')


def ffmpeg_filter(css):
    operations = ['format=rgb24']
    identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    for name, value in re.findall(r'([a-z-]+)\(([0-9.]+)(?:deg)?\)', css):
        amount = float(value)
        if name == 'contrast':
            expression = f"clip((val-127.5)*{amount:.5f}+127.5,0,255)"
            operations.append('lutrgb=' + ':'.join(f"{channel}='{expression}'" for channel in 'rgb'))
            continue
        if name in {'sepia', 'grayscale'}:
            target = ([[.393, .769, .189], [.349, .686, .168], [.272, .534, .131]] if name == 'sepia'
                      else [[.2126, .7152, .0722]] * 3)
            matrix = [[identity[i][j] * (1-amount) + target[i][j] * amount for j in range(3)] for i in range(3)]
        elif name == 'saturate':
            luma = [.213, .715, .072]
            matrix = [[luma[j]*(1-amount) + identity[i][j]*amount for j in range(3)] for i in range(3)]
        elif name == 'hue-rotate':
            c, s = math.cos(math.radians(amount)), math.sin(math.radians(amount))
            matrix = [[.213+.787*c-.213*s, .715-.715*c-.715*s, .072-.072*c+.928*s],
                      [.213-.213*c+.143*s, .715+.285*c+.140*s, .072-.072*c-.283*s],
                      [.213-.213*c-.787*s, .715-.715*c+.715*s, .072+.928*c+.072*s]]
        else:
            raise ValueError(f'Unsupported preview filter: {name}')
        operations.append('colorchannelmixer=' + ':'.join(
            f'{a}{b}={matrix[i][j]:.5f}' for i,a in enumerate('rgb') for j,b in enumerate('rgb')
        ))
    return ','.join(operations)


FILTERS = {name: ffmpeg_filter(css) for name, css in CSS_FILTERS.items()}
FILTERS['original'] = ''
