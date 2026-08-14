import os
from PIL import Image
import numpy as np

def clean_background(img_path, output_path, border_clean=4, noise_thresh=10.0):
    img = Image.open(img_path).convert('RGB')
    arr = np.array(img).astype(np.float32)
    h, w, _ = arr.shape

    # Clean outer boundary gridline artifacts if present
    if border_clean > 0:
        arr[:border_clean, :] = 0
        arr[-border_clean:, :] = 0
        arr[:, :border_clean] = 0
        arr[:, -border_clean:] = 0

    R = arr[:, :, 0]
    G = arr[:, :, 1]
    B = arr[:, :, 2]

    # Calculate alpha based on color intensity (black background = transparent)
    max_c = np.maximum(np.maximum(R, G), B)

    # Smooth curve for alpha
    alpha = np.where(max_c <= noise_thresh, 0.0, (max_c - noise_thresh) / (255.0 - noise_thresh))
    alpha = np.clip(alpha, 0.0, 1.0)

    # Recover true foreground color by un-premultiplying against black
    safe_alpha = np.maximum(alpha, 1e-5)
    R_clean = np.clip(R / safe_alpha, 0.0, 255.0)
    G_clean = np.clip(G / safe_alpha, 0.0, 255.0)
    B_clean = np.clip(B / safe_alpha, 0.0, 255.0)
    A_clean = np.clip(alpha * 255.0, 0.0, 255.0)

    rgba_arr = np.stack([R_clean, G_clean, B_clean, A_clean], axis=-1).astype(np.uint8)
    rgba_img = Image.fromarray(rgba_arr, 'RGBA')
    
    # Save optimized PNG
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    rgba_img.save(output_path, 'PNG', optimize=True)
    print(f"Processed: {os.path.basename(img_path)} -> {output_path} (dim={w}x{h}, transparent pixels={(A_clean > 0).sum()})")

def main():
    src_dir = r"c:\Users\ziono\Documents\PersonalStatengine\heaven-stat-engine\heaven_stat_engine_logo_components"
    public_brand_dir = r"c:\Users\ziono\Documents\PersonalStatengine\heaven-stat-engine\public\brand"

    files = sorted([f for f in os.listdir(src_dir) if f.endswith('.png')])

    for f in files:
        src_path = os.path.join(src_dir, f)
        brand_path = os.path.join(public_brand_dir, f)
        
        # 01_primary_logo.png does not have border artifacts, but can use border_clean=1
        border = 1 if f in ['01_primary_logo.png', '10_concept_meaning.png', '11_color_palette.png'] else 4
        
        # Clean and overwrite in heaven_stat_engine_logo_components
        clean_background(src_path, src_path, border_clean=border)
        # Clean and overwrite in public/brand
        clean_background(src_path, brand_path, border_clean=border)

    # Also update favicon and app icon
    favicon_src = os.path.join(public_brand_dir, "06_app_favicon.png")
    app_icon_dst = r"c:\Users\ziono\Documents\PersonalStatengine\heaven-stat-engine\src\app\icon.png"
    public_favicon_dst = r"c:\Users\ziono\Documents\PersonalStatengine\heaven-stat-engine\public\favicon.png"

    clean_background(favicon_src, app_icon_dst, border_clean=0)
    clean_background(favicon_src, public_favicon_dst, border_clean=0)
    print("Updated app icon and favicon with transparent background.")

if __name__ == '__main__':
    main()
