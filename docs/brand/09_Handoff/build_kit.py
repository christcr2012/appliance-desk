from pathlib import Path
import math, json, shutil, csv, hashlib, zipfile, html, io, textwrap
import fitz
from PIL import Image
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont as RLFont
from pypdf import PdfReader, PdfWriter

BASE=Path(__file__).resolve().parent.parent
ROOT=BASE/'output/Robinson_Appliance_Rentals_Brand_Kit_v2.0'
ROOT.mkdir(parents=True,exist_ok=True)
E='#123C2D'; G='#B9E66B'; I='#F7F5EC'; C='#17251E'; S='#DCE7DF'; M='#4E6658'; W='#FFFFFF'; D='#0C1E16'
DOMAIN='robinsonappliancerentals.com'
FONTS={}
for weight in [400,600,700,800]:
    font=instantiateVariableFont(TTFont(BASE/'work/fonts/Manrope.ttf'),{'wght':weight},inplace=False,updateFontNames=True)
    FONTS[weight]=font
    p=BASE/f'work/fonts/Manrope-{weight}.ttf';font.save(p)
    pdfmetrics.registerFont(RLFont(f'Manrope{weight}',str(p)))

def write(rel,data):
    p=ROOT/rel;p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(data,encoding='utf-8');return p

def width(text,size,weight=400,tracking=0):
    f=FONTS[weight]; cmap=f.getBestCmap(); upm=f['head'].unitsPerEm
    return sum(f['hmtx'][cmap.get(ord(ch),'space')][0]*size/upm for ch in text)+max(0,len(text)-1)*tracking

class Art:
    def __init__(self,w,h,bg=None):
        self.w=w;self.h=h;self.a=[];self.live=[]
        if bg:self.rect(0,0,w,h,bg)
    def add(self,v,live=None): self.a.append(v);self.live.append(v if live is None else live)
    def rect(self,x,y,w,h,color,rx=0):self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{color}"/>')
    def line(self,x1,y1,x2,y2,color,sw=1):self.add(f'<path d="M{x1} {y1}L{x2} {y2}" stroke="{color}" stroke-width="{sw}" fill="none"/>')
    def path(self,d,color):self.add(f'<path d="{d}" fill="{color}"/>')
    def text(self,t,x,y,size,color=C,weight=400,tracking=0):
        f=FONTS[weight];gs=f.getGlyphSet();cm=f.getBestCmap();sc=size/f['head'].unitsPerEm;out=[];pos=x
        for ch in t:
            gn=cm.get(ord(ch),'space');pen=SVGPathPen(gs);gs[gn].draw(pen)
            out.append(f'<path d="{pen.getCommands()}" transform="translate({pos:.4f} {y}) scale({sc:.7f} {-sc:.7f})"/>')
            pos+=f['hmtx'][gn][0]*sc+tracking
        self.add(f'<g fill="{color}">'+''.join(out)+'</g>',f'<text x="{x}" y="{y}" font-family="Manrope" font-size="{size}" font-weight="{weight}" letter-spacing="{tracking}" fill="{color}">{html.escape(t)}</text>')
    def para(self,t,x,y,size=16,maxw=500,color=C,weight=400,leading=1.5):
        words=t.split();line='';yy=y
        for word in words:
            test=(line+' '+word).strip()
            if width(test,size,weight)>maxw and line:
                self.text(line,x,yy,size,color,weight);yy+=size*leading;line=word
            else:line=test
        if line:self.text(line,x,yy,size,color,weight);yy+=size*leading
        return yy
    def mark(self,x,y,size,main=E,accent=G):
        # Geometric refinement of the generated concept; native vector paths.
        p=f'<g transform="translate({x} {y}) scale({size/100})"><path d="M0 0H57C83 0 98 13 98 33C98 51 87 62 65 65L100 100H64L9 45H55C63 45 67 41 67 35C67 29 63 25 55 25H0Z" fill="{main}"/><path d="M0 49L49 100H0Z" fill="{accent}"/></g>'
        self.add(p)
    def logo(self,x,y,w=500,variant='light',layout='horizontal'):
        start=len(self.a)
        main,accent,sub=(E,G,C) if variant=='light' else (I,G,I)
        if variant=='black':main=accent=sub='#000000'
        if variant=='white':main=accent=sub=W
        if variant=='evergreen':main=accent=sub=E
        if layout=='mark':self.mark(x,y,w,main,accent);return
        if layout=='stacked':
            self.mark(x+w*.34,y,w*.32,main,accent)
            fs=w/width('ROBINSON',1,800);self.text('ROBINSON',x,y+w*.51,fs,main,800)
            fs2=w/width('APPLIANCE RENTALS',1,700,.15)
            self.text('APPLIANCE RENTALS',x,y+w*.59,fs2,sub,700,fs2*.15)
            self.live[start:]=self.a[start:];return
        sz=w*.185;self.mark(x,y,sz,main,accent)
        tx=x+sz+w*.042;avail=w-(tx-x)
        fs=avail/width('ROBINSON',1,800)
        self.text('ROBINSON',tx,y+sz*.58,fs,main,800)
        fs2=avail/width('APPLIANCE RENTALS',1,700,.15)
        self.text('APPLIANCE RENTALS',tx,y+sz*.95,fs2,sub,700,fs2*.15)
        self.live[start:]=self.a[start:]
    def motif(self,x,y,size,color=G):
        self.path(f'M{x} {y}L{x+size} {y+size}H{x}Z',color)
    def svg(self,live=False):return f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" viewBox="0 0 {self.w} {self.h}">'+''.join(self.live if live else self.a)+'</svg>'

def save_art(a,rel,pngw=None,pdf=True,editable=False,trim=None):
    p=write(rel+'.svg',a.svg())
    doc=fitz.open(stream=a.svg().encode(),filetype='svg');pdfdoc=fitz.open('pdf',doc.convert_to_pdf())
    if trim:
        page=pdfdoc[0];page.set_trimbox(fitz.Rect(*trim));page.set_bleedbox(page.mediabox)
    if pdf:pdfdoc.save(str(ROOT/(rel+'.pdf')))
    if pngw:
        pdfdoc[0].get_pixmap(matrix=fitz.Matrix(pngw/a.w,pngw/a.w),alpha=True).save(str(ROOT/(rel+'.png')))
    if editable:write(rel+'-EDITABLE.svg',a.svg(live=True))
    return p

# LOGO SYSTEM: bounded, no raster embeds, text converted to paths.
for layout,dims in [('horizontal',(1100,260)),('stacked',(680,480)),('mark',(280,280))]:
    for variant in ['light','dark','black','white','evergreen']:
        a=Art(*dims)
        if layout=='horizontal':a.logo(50,37,1000,variant)
        elif layout=='stacked':a.logo(60,45,560,variant,layout)
        else:a.mark(40,40,200,*({'light':(E,G),'dark':(I,G),'black':('#000','#000'),'white':(W,W),'evergreen':(E,E)}[variant]))
        save_art(a,f'01_Logos/{layout}/Robinson-{layout}-{variant}',pngw=3000 if layout=='horizontal' else 1600)

# Square artwork keeps an ample circular-crop safe zone.
for variant,bg,main,accent in [('evergreen',E,I,G),('ivory',I,E,G)]:
    a=Art(1024,1024,bg);a.mark(260,260,504,main,accent)
    save_art(a,f'02_Icons/Avatar-{variant}',pngw=1024)
    if variant=='evergreen':
        doc=fitz.open(stream=a.svg().encode(),filetype='svg');d=fitz.open('pdf',doc.convert_to_pdf())
        for px in [16,32,48,64,180,192,512]:
            # One-color small favicon has stronger contrast than the two-color avatar.
            tiny=Art(px,px,E);tiny.mark(px*.2,px*.2,px*.6,I,I)
            td=fitz.open('pdf',fitz.open(stream=tiny.svg().encode(),filetype='svg').convert_to_pdf())
            td[0].get_pixmap(alpha=False).save(str(ROOT/f'02_Icons/icon-{px}.png'))
        Image.open(ROOT/'02_Icons/icon-512.png').save(ROOT/'02_Icons/favicon.ico',sizes=[(16,16),(32,32),(48,48)])
        tiny=Art(100,100,E);tiny.mark(20,20,60,I,I);write('02_Icons/favicon.svg',tiny.svg())
write('02_Icons/site.webmanifest',json.dumps({'name':'Robinson Appliance Rentals','short_name':'Robinson','start_url':'/','display':'standalone','background_color':I,'theme_color':E,'icons':[{'src':f'/brand/icon-{n}.png','sizes':f'{n}x{n}','type':'image/png','purpose':'any maskable'} for n in [192,512]]},indent=2))

# SOCIAL & ADVERTISING: no unverifiable rates, stock or service guarantees.
def social(w,h,kind):
    a=Art(w,h,E if kind!='property' else I)
    dark=kind!='property';ink=I if dark else E
    margin=round(w*.074);lw=w*.57
    a.logo(margin,250 if h/w>1.5 else margin,lw,'dark' if dark else 'light')
    if h/w>1.5:
        top=650;size=118;lines=['Make room','for everyday.'];suby=950
        a.mark(margin,1120,220,I,G)
    else:
        top=h*.40;size=w*.093;lines=['Make room','for everyday.'];suby=top+size*2.05
    if kind=='property':lines=['More homes.','One partner.'];size=w*.087
    for idx,t in enumerate(lines):a.text(t,margin,top+idx*size*1.12,size,ink,800)
    copy='Explore appliance rentals for your home.' if kind!='property' else 'Appliance rental options for rental properties.'
    a.para(copy,margin,suby,w*.03,w*.74,ink,400,1.4)
    by=h-430 if h/w>1.5 else h-185
    a.rect(margin,by,w*.45,64,G,12);a.text('Explore your options',margin+24,by+41,w*.026,E,700)
    a.text(DOMAIN,margin,h-300 if h/w>1.5 else h-80,w*.023,ink,600)
    a.motif(w-150,h-390 if h/w>1.5 else h-150,110,G if dark else E)
    return a

for name,w,h,kind in [('Social-square',1080,1080,'consumer'),('Social-portrait',1080,1350,'consumer'),('Story-vertical',1080,1920,'consumer'),('Property-manager-square',1080,1080,'property')]:
    save_art(social(w,h,kind),'04_Social_Advertising/'+name,pngw=w,editable=True)

a=Art(1200,630,I);a.logo(70,60,540);a.text('Make room',70,320,88,E,800);a.text('for everyday.',70,418,88,E,800);a.text('Appliance rentals for the way you live.',74,487,29,M,400);a.mark(910,200,200,E,G);a.text(DOMAIN,74,570,23,E,600)
save_art(a,'04_Social_Advertising/Website-social-share',pngw=1200,editable=True)
a=Art(1640,624,E);a.logo(130,88,650,'dark');a.text('Make room for everyday.',130,357,85,I,800);a.text('Appliance rentals for the way you live.',135,433,32,I);a.text(DOMAIN,135,510,25,G,600);a.mark(1290,135,220,I,G)
save_art(a,'04_Social_Advertising/Wide-cover',pngw=1640,editable=True)

# PRINT: dimensions are PDF points, with 9pt / 0.125in bleed.
def print_art(w,h,bg):return Art(w+18,h+18,bg)
a=print_art(252,144,E);a.logo(25,40,220,'dark');a.text('Make room for everyday.',26,125,10.5,I,600)
save_art(a,'05_Print/Business-card-front',pngw=1125,editable=True,trim=(9,9,261,153))
a=print_art(252,144,I);a.text('Appliance rentals.',26,47,17,E,800);a.text('Everyday possibilities.',26,70,17,E,800);a.text('Explore options for your home or rental property.',26,100,7.9,C);a.text(DOMAIN,26,127,9,E,700);a.motif(223,121,19,G)
save_art(a,'05_Print/Business-card-back',pngw=1125,editable=True,trim=(9,9,261,153))
a=print_art(612,792,I);a.logo(48,47,385);a.rect(0,168,630,415,E);a.text('Make room',47,270,70,I,800);a.text('for everyday.',47,350,70,I,800);a.para('Explore appliance rental options for your home.',49,417,23,455,I,400,1.45);a.motif(505,483,84,G);a.text('Start with what you need.',48,633,28,E,800);a.para('Visit our website to explore options and ask about availability in your area.',49,674,16,485,C);a.rect(48,725,534,44,G,6);a.text(DOMAIN,66,754,18,E,700)
save_art(a,'05_Print/Flyer-letter',pngw=2550,editable=True,trim=(9,9,621,801))
for side in ['front','back']:
    a=print_art(432,288,E if side=='front' else I)
    if side=='front':
        a.logo(30,32,285,'dark');a.text('Make room',30,155,47,I,800);a.text('for everyday.',30,210,47,I,800);a.text('Explore appliance rentals for your home.',32,254,13,I);a.motif(360,236,45,G)
    else:
        a.logo(30,30,245);a.text('Your next step starts here.',30,126,25,E,800);a.para('Explore appliance rental options and ask about availability in your area.',30,166,14,355,C);a.rect(30,235,390,38,G,6);a.text(DOMAIN,44,260,15,E,700)
    save_art(a,'05_Print/Handout-6x4-'+side,pngw=1875,editable=True,trim=(9,9,441,297))
a=Art(612,792,W);a.logo(44,39,310);a.line(44,128,568,128,S,1);a.line(44,730,568,730,S,1);a.text(DOMAIN,44,756,10,E,600);a.mark(541,744,18,E,G)
save_art(a,'05_Print/Letterhead-letter',pngw=1530,editable=True)
a=Art(1728,1296,E);a.logo(120,130,1488,'dark');a.text('APPLIANCE',120,715,177,I,800);a.text('RENTALS',120,925,177,I,800);a.rect(0,1040,1728,256,G);a.text(DOMAIN,116,1190,79,E,700)
save_art(a,'05_Print/Sign-24x18',pngw=2400,editable=True)

# FABRICATION: scalable artwork / placement plans, not a vehicle-specific wrap.
a=Art(1728,576,I);a.logo(78,65,1450);a.text(DOMAIN,83,443,70,E,700);a.rect(0,522,1728,54,E)
save_art(a,'06_Vehicles_Apparel/Vehicle-panel-24x8',pngw=2400,editable=True)
a=Art(720,720,E);a.logo(85,92,550,'dark','stacked');a.text(DOMAIN,89,575,25,I,600);a.motif(564,619,60,G)
save_art(a,'06_Vehicles_Apparel/Rear-panel-10x10',pngw=1600,editable=True)
for purpose,w,h in [('Chest-mark-3in',216,216),('Uniform-back-11in',792,252)]:
    a=Art(w,h)
    if w==216:a.mark(20,20,176,E,E)
    else:a.logo(32,43,728,'evergreen')
    save_art(a,'06_Vehicles_Apparel/'+purpose,pngw=1600)

# REUSABLE DECORATIVE SYSTEM + SERVICE ICONS.
a=Art(400,400,I)
for x,y in [(0,0),(200,0),(0,200),(200,200)]:a.motif(x+40,y+40,115,S)
save_art(a,'03_Design_System/Pattern-tile',pngw=800,pdf=False)
icons={
 'appliance':'M6 2H26V30H6ZM6 8H26 M10 5H12 M22 19A6 6 0 1 1 10 19A6 6 0 1 1 22 19',
 'delivery':'M2 8H20V24H2ZM20 14H26L30 19V24H20 M6 28A3 3 0 1 0 6 22A3 3 0 1 0 6 28 M25 28A3 3 0 1 0 25 22A3 3 0 1 0 25 28',
 'calendar':'M4 6H28V29H4ZM4 12H28 M10 2V9 M22 2V9 M10 19L14 23L23 16',
 'home':'M2 15L16 3L30 15 M6 12V29H26V12 M12 29V19H20V29',
 'support':'M5 18V15A11 11 0 0 1 27 15V18 M5 15H2V24H8V15H5 M27 15H30V24H24V15H27 M27 24V28H17',
 'property':'M3 29V7H17V29 M17 14H29V29 M8 12H12 M8 18H12 M21 19H25 M21 24H25 M9 29V24H13V29'}
for name,path in icons.items():
    a=Art(32,32);a.add(f'<path d="{path}" stroke="{E}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>')
    save_art(a,'03_Design_System/Service-icons/'+name,pngw=128,pdf=False)

# COLORS, FONT PACKAGE AND WEB TOKENS.
palette={'evergreen':E,'fresh':G,'ivory':I,'ink':C,'sage':S,'muted':M,'white':W,'night':D}
tokens={'version':'2.0','color':palette,'font':{'family':'Manrope','fallback':'Arial, sans-serif','bodyWeight':400,'labelWeight':600,'headingWeight':800},'light':{'background':I,'surface':W,'text':C,'muted':M,'border':'#A5B8AB','primary':E,'onPrimary':W,'accent':G,'onAccent':E,'focus':E},'dark':{'background':D,'surface':'#152E22','text':I,'muted':'#B7C8BB','border':'#789985','primary':G,'onPrimary':E,'accent':G,'onAccent':E,'focus':G},'radius':{'control':'8px','card':'16px'},'space':[4,8,12,16,24,32,48,64,96]}
write('03_Design_System/brand-tokens.json',json.dumps(tokens,indent=2))
css='''/* Robinson Appliance Rentals v2.0 */
@font-face {font-family:Manrope;src:url('./fonts/Manrope-Variable.woff') format('woff');font-weight:200 800;font-style:normal;font-display:swap;}
:root {color-scheme:light;--font-brand:Manrope,Arial,sans-serif;--radius-control:8px;--radius-card:16px;}
'''
for mode in ['light','dark']:
    selector=':root, [data-theme="light"]' if mode=='light' else '[data-theme="dark"]'
    css+=selector+'{'+''.join(f'--{k}:{v};' for k,v in tokens[mode].items())+'}\n'
css+='''body{background:var(--background);color:var(--text);font-family:var(--font-brand);line-height:1.55;}
h1,h2,h3{font-weight:800;line-height:1.12;letter-spacing:-.025em;}
.brand-button{background:var(--primary);color:var(--onPrimary);border:0;border-radius:var(--radius-control);padding:12px 20px;font:600 1rem var(--font-brand);min-height:44px;cursor:pointer;}
.brand-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-card);padding:24px;}
:focus-visible{outline:3px solid var(--focus);outline-offset:3px;}
a{color:inherit;text-underline-offset:3px;}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important;}}
'''
write('07_Web_Email/brand.css',css)
fp=ROOT/'07_Web_Email/fonts';fp.mkdir(parents=True,exist_ok=True)
font=TTFont(BASE/'work/fonts/Manrope.ttf');font.flavor='woff';font.save(fp/'Manrope-Variable.woff')
shutil.copy(BASE/'work/fonts/Manrope.ttf',fp/'Manrope-Variable.ttf');shutil.copy(BASE/'work/fonts/Manrope-OFL.txt',fp/'OFL.txt')
for n in [400,600,700,800]:shutil.copy(BASE/f'work/fonts/Manrope-{n}.ttf',fp/f'Manrope-{n}.ttf')
write('03_Design_System/Color-swatches.gpl','GIMP Palette\nName: Robinson Appliance Rentals v2\nColumns: 4\n#\n'+'\n'.join(f'{int(v[1:3],16)} {int(v[3:5],16)} {int(v[5:7],16)} {k}' for k,v in palette.items()))
write('03_Design_System/Fonts-and-licenses.md','''# Typography
Manrope by Mikhail Sharanda is the primary family. Headings 800; subheadings 700; labels 600; body 400. Body text should usually be 16-18px online or 10-12pt in print. Use Arial for email and office fallbacks.

The bundled Google Fonts variable source and derived static instances are distributed with the included SIL Open Font License. Keep OFL.txt with redistributed font files. The logo wordmark is supplied as outlines; a font installation is not required to render the master logos. Do not retype it.

Source: https://github.com/google/fonts/tree/main/ofl/manrope
Font creator: https://www.sharanda.com/manrope
Fetched 2026-09-29. Static instances produced at weights 400, 600, 700, 800; the glyph design is unchanged.
''')

# EMAIL: business-only signature ready to personalize; editable transactional layout.
write('07_Web_Email/Email-signature.html',f'''<!doctype html><html><body><table role="presentation" cellpadding="0" cellspacing="0" style="font-family:Arial,sans-serif;color:{E}"><tr><td style="border-left:5px solid {G};padding:4px 0 4px 16px"><strong style="font-size:20px">ROBINSON</strong><br><span style="font-size:11px;letter-spacing:2px">APPLIANCE RENTALS</span><br><br><span style="font-size:13px">Make room for everyday.</span><br><a href="https://{DOMAIN}" style="color:{E};font-size:13px">{DOMAIN}</a></td></tr></table></body></html>''')
write('07_Web_Email/Customer-email-EDITABLE.html',f'''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:{I};font-family:Arial,sans-serif;color:{C}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:white"><tr><td style="padding:32px;background:{E};color:white"><strong style="font-size:25px">ROBINSON</strong><br><span style="font-size:12px;letter-spacing:2px">APPLIANCE RENTALS</span></td></tr><tr><td style="padding:32px"><h1 style="font-size:28px;margin-top:0">Your next step, made clear.</h1><p>Hello {{{{customer_name}}}},</p><p>{{{{message_body}}}}</p><p style="padding:18px;background:{I}">{{{{next_step_details}}}}</p><p><a href="{{{{action_url}}}}" style="display:inline-block;background:{E};color:white;text-decoration:none;padding:14px 22px;border-radius:6px">{{{{action_label}}}}</a></p><p>Robinson Appliance Rentals</p></td></tr><tr><td style="padding:24px 32px;border-top:4px solid {G};font-size:12px"><a href="https://{DOMAIN}" style="color:{E}">{DOMAIN}</a><br>{{{{verified_business_contact}}}}</td></tr></table></td></tr></table></body></html>''')

# LOCAL WEB SPECIMEN: visual handoff, intentionally not a deployed website.
logo_path='../01_Logos/horizontal/Robinson-horizontal-light.svg';dark_logo='../01_Logos/horizontal/Robinson-horizontal-dark.svg'
write('07_Web_Email/Web-brand-preview.html',f'''<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Robinson brand preview</title><link rel="stylesheet" href="brand.css"><style>*{{box-sizing:border-box}}body{{margin:0}}header,main,footer{{max-width:1200px;margin:auto;padding:28px}}header{{display:flex;align-items:center;justify-content:space-between;gap:20px}}header img{{width:min(340px,60vw)}}.hero{{padding:70px 0;display:grid;grid-template-columns:1.5fr 1fr;gap:48px;align-items:center}}h1{{font-size:clamp(46px,7vw,88px);margin:18px 0}}.eyebrow{{font-weight:700;letter-spacing:.12em;font-size:12px}}.hero p{{max-width:530px;font-size:20px;color:var(--muted)}}.mark{{width:100%;padding:35px;background:var(--accent);border-radius:28px}}.grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}}label{{display:block;font-weight:600}}input{{width:100%;padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font:inherit;margin:8px 0 18px}}.note{{font-size:13px;color:var(--muted)}}footer{{margin-top:50px;border-top:1px solid var(--border)}}@media(max-width:700px){{.hero,.grid{{grid-template-columns:1fr}}.hero{{padding:30px 0}}.mark{{max-width:250px}}}}</style></head><body><header><img id="logo" src="{logo_path}" alt="Robinson Appliance Rentals"><button class="brand-button" id="theme" aria-pressed="false">Dark mode</button></header><main><section class="hero"><div><span class="eyebrow">APPLIANCE RENTALS</span><h1>Make room<br>for everyday.</h1><p>Explore appliance rental options for your home. Start with what you need, and let us help you find your next step.</p><a class="brand-button" style="display:inline-block;text-decoration:none" href="https://{DOMAIN}">Explore rental options</a></div><img class="mark" src="../01_Logos/mark/Robinson-mark-evergreen.svg" alt=""></section><section class="grid"><article class="brand-card"><h2>Your home.</h2><p>Clear information for everyday appliance needs.</p></article><article class="brand-card"><h2>Your properties.</h2><p>A place to discuss appliance rental needs across your properties.</p></article><article class="brand-card"><h2>Your next step.</h2><p>Ask about options and availability in your area.</p></article></section><section style="max-width:560px;margin-top:56px"><h2>Form and status styling</h2><label for="sample">Example field</label><input id="sample" placeholder="Preview only - no information is sent"><p class="note">This file demonstrates the brand. It is not an operating rental portal.</p></section></main><footer>Robinson Appliance Rentals · Brand system v2.0</footer><script>const b=document.getElementById('theme');b.onclick=()=>{{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';b.textContent=dark?'Light mode':'Dark mode';b.setAttribute('aria-pressed',String(dark));document.getElementById('logo').src=dark?'{dark_logo}':'{logo_path}';}};</script></body></html>''')

# INVOICE + ESTIMATE + WORK ORDER: real editable AcroForm fields.
def business_form(name,title,rows,notes):
    path=ROOT/f'08_Business_Forms/{name}.pdf';path.parent.mkdir(parents=True,exist_ok=True)
    c=canvas.Canvas(str(path),pagesize=(612,792));c.setTitle('Robinson '+title+' template')
    c.setFillColor(HexColor(E));c.rect(0,665,612,127,fill=1,stroke=0)
    c.setFillColor(HexColor(I));c.setFont('Manrope800',22);c.drawRightString(570,710,title)
    c.setFillColor(HexColor(G));c.rect(0,659,612,6,fill=1,stroke=0)
    def field(key,label,x,y,w,h=24):
        c.setFont('Manrope600',9);c.setFillColor(HexColor(E));c.drawString(x,y+h+7,label)
        c.acroForm.textfield(name=key,tooltip=label,x=x,y=y,width=w,height=h,fontName='Helvetica',fontSize=10,borderWidth=.6,borderColor=HexColor('#A5B8AB'),fillColor=HexColor('#FFFFFF'),textColor=HexColor(C),forceBorder=True,fieldFlags='multiline' if h>30 else '')
    field('business_details','Verified business name / contact / remit-to details',42,584,528,42)
    field('customer','Customer / property',42,514,320,40);field('document_number','Reference number',390,532,180)
    field('date','Date',390,477,180);field('address','Service / billing address',42,444,320,40)
    yy=388
    if name in ['Invoice','Estimate']:
        for label,x in [('Description',42),('Quantity',338),('Rate',405),('Amount',482)]:
            c.setFont('Manrope700',9);c.setFillColor(HexColor(E));c.drawString(x,yy+25,label)
        for i in range(4):
            for key,x,w in [('description',42,282),('quantity',338,55),('rate',405,65),('amount',482,88)]:
                c.acroForm.textfield(name=f'{key}_{i+1}',tooltip=f'{key} line {i+1}',x=x,y=yy-i*34,width=w,height=25,fontSize=10,borderWidth=.5,borderColor=HexColor('#A5B8AB'),fillColor=HexColor(W),textColor=HexColor(C),forceBorder=True)
        field('subtotal','Subtotal',390,213,180);field('tax_fees','Applicable tax / fees',390,163,180);field('total','Total',390,113,180)
        field('terms','Confirmed terms / due date / next step',42,132,320,94)
    else:
        field('equipment','Appliance / asset ID / serial number',42,368,528,40)
        field('scope','Requested work / approved scope',42,260,528,75)
        field('completion','Completion notes / condition / follow-up',42,151,528,76)
        field('technician','Technician / reference',42,91,255);field('completion_date','Completion date',315,91,255)
    c.setFont('Manrope400',8);c.setFillColor(HexColor(M));c.drawString(42,61,notes)
    c.setFont('Manrope600',9);c.setFillColor(HexColor(E));c.drawString(42,38,DOMAIN)
    c.showPage();c.save()
    overlay=Art(612,792);overlay.logo(42,35,285,'dark')
    odoc=fitz.open('pdf',fitz.open(stream=overlay.svg().encode(),filetype='svg').convert_to_pdf())
    fd=fitz.open(path);fd[0].show_pdf_page(fd[0].rect,odoc,0)
    tmp=path.with_suffix('.tmp.pdf');fd.save(tmp);fd.close();tmp.replace(path)
business_form('Invoice','INVOICE',4,'Template: enter and verify all amounts. Totals do not calculate automatically.')
business_form('Estimate','ESTIMATE',4,'Template: confirm scope, term, availability and expiry before sending. Not a rental agreement.')
business_form('Work-order','WORK ORDER',0,'Template: operational record only. Add required authorization through your business workflow.')

# BRAND GUIDELINES - art-directed pages with generous whitespace.
pages=[]
def page(k,title,deck='',dark=False):
    a=Art(900,1125,E if dark else I);ink=I if dark else E
    a.text('ROBINSON / BRAND SYSTEM',60,50,12,ink,700,1.4);a.text(f'{k:02}',800,50,12,ink,700)
    a.text(title,60,136,43,ink,800)
    if deck:a.para(deck,62,179,17,755,ink,400)
    a.line(60,1054,840,1054,G if dark else S,1)
    a.text('APPLIANCE RENTALS',60,1080,10,ink,700,1.2);a.text('V2.0 / SEPTEMBER 2026',647,1080,10,ink,600)
    pages.append(a);return a
def block(a,title,body,x,y,w=355,dark=False):
    a.text(title,x,y,23,I if dark else E,800)
    return a.para(body,x,y+35,16,w,I if dark else C,400,1.55)

a=Art(900,1125,E);a.logo(64,67,615,'dark');a.text('Make room',60,423,94,I,800);a.text('for everyday.',60,534,94,I,800);a.mark(590,678,240,I,G);a.text('THE ROBINSON BRAND SYSTEM',63,890,17,G,700,1.5);a.para('A scalable identity for homes, properties, people and the next chapter.',63,936,23,530,I);a.text('PRODUCTION KIT / V2.0 / 2026',63,1061,12,I,600,1.1);pages.append(a)
a=page(2,'A brand built to grow.','A recognizable family name. A practical service. A confident visual signature.')
block(a,'The idea','Make room for everyday. Appliance rentals should make the next step feel manageable. The brand balances household warmth with operational competence.',60,298,735)
block(a,'What stays constant','The Robinson name, split-R mark, evergreen anchor, typography and direct voice form the permanent core.',60,491)
block(a,'What can evolve','Categories, regions, offers, channels, photographs and service programs can expand without replacing the identity.',480,491)
block(a,'Who it serves','Residents and families who need appliances, and property owners or managers coordinating appliance needs across homes.',60,732)
block(a,'What it should feel like','Capable, straightforward and welcoming. Avoid luxury posturing, discount-store clutter and unsubstantiated savings claims.',480,732)
a=page(3,'One mark. Many settings.','The split-R is a simple, scalable symbol of the Robinson name.')
a.mark(80,307,300,E,G);a.mark(543,332,225,E,E)
block(a,'The signature','The open counter and diagonal cut create a recognizable silhouette. The fresh-green base gives the mark a point of energy.',60,727)
block(a,'The production master','Every delivered logo SVG uses native paths, including the wordmark. There are no embedded bitmap images or live font dependencies.',480,727)
a=page(4,'Choose the right lockup.','Use the complete business name wherever the audience is meeting you for the first time.')
a.logo(76,299,740);a.text('PRIMARY / HORIZONTAL',76,484,13,M,700,1)
a.logo(82,574,390,'light','stacked');a.mark(633,591,136,E,G)
a.text('SECONDARY / STACKED',80,866,13,M,700,1);a.text('ICON / REPEAT USE',574,866,13,M,700,1)
a.para('The icon works for favicons, avatars, app navigation and repeat brand encounters. Keep “Appliance Rentals” visible elsewhere in the surrounding context.',62,946,16,745)
a=page(5,'Give the logo room.','Clear space protects recognition. Minimums below are starting standards, not a substitute for a physical proof.')
a.logo(118,310,660);a.line(80,274,820,274,M);a.line(80,481,820,481,M);a.line(80,274,80,481,M);a.line(820,274,820,481,M)
block(a,'Clear space','Keep at least one quarter of the R-mark height clear on every side of the visible logo. No text, trim edge, handle, seam or competing graphic enters this space.',60,586)
block(a,'Minimum size','Full horizontal logo: 240px wide online or 2.25in wide in print. Stacked: 180px or 1.5in. Standalone mark: 24px or 0.25in. Use dedicated icons at 16px.',480,586)
a.text('KEEP IT INTACT',60,841,16,E,800)
a.para('Do not stretch, rotate, outline, add shadows, add gradients, change the cut, retype the wordmark or place the logo across a busy photograph. Use the supplied one-color version when production is limited.',60,880,17,750)
a=page(6,'Green, with breathing room.','Evergreen leads. Ivory gives warmth. Fresh green acts as an accent, not a page-wide default.')
cols=[('Evergreen',E,'Primary brand / buttons'),('Fresh',G,'Accent / emphasis'),('Ivory',I,'Main light background'),('Ink',C,'Body text'),('Sage',S,'Quiet surfaces'),('Muted',M,'Secondary text')]
for idx,(name,col,use) in enumerate(cols):
    x=60+(idx%3)*270;y=270+(idx//3)*287;a.rect(x,y,240,154,col,8)
    if col==I:a.line(x,y+154,x+240,y+154,S,2)
    a.text(name,x,y+190,21,E,800);a.text(col,x,y+217,15,C,600);a.text(use,x,y+242,12,M)
a.para('Typical marketing composition: roughly 55% ivory, 30% evergreen, 10% neutral and 5% fresh green. Treat this as a useful balance, not a rigid quota. The monochrome system remains fully valid.',60,902,17,747)
a=page(7,'Light and dark, equally clear.','A coordinated theme system keeps the brand recognizable throughout the website and owner portal.')
for x,bg,fg,button,onbutton,label in [(60,W,C,E,W,'LIGHT'),(470,D,I,G,E,'DARK')]:
    a.rect(x,290,370,424,bg,16);a.text(label,x+28,335,12,fg,700,1.2);a.text('Your next step.',x+28,406,29,fg,800);a.para('Appliance rentals for the way you live.',x+28,453,18,300,fg);a.rect(x+28,578,300,57,button,8);a.text('Explore your options',x+48,615,20,onbutton,700)
block(a,'Pair colors deliberately','Use white on evergreen, ink on ivory and evergreen on fresh green. Fresh green is not body text on white. Muted text, borders and focus rings have separate theme tokens.',60,790,355)
block(a,'Preserve meaning','Keep focus visible. Pair every status color with a label or icon. Errors are not green. Use semantic error, warning and success tokens independently of the marketing palette.',480,790,355)
a=page(8,'Typography with confidence.','Manrope is the primary family. Use weight and space to create hierarchy.')
a.text('Make room.',60,344,104,E,800);a.text('Manrope ExtraBold / 800',63,393,16,M,600)
a.text('Clear information. Easy next steps.',60,482,35,E,700);a.text('Manrope Bold / 700',63,521,16,M,600)
a.para('Use simple sentences and comfortable line lengths. Give customers the information they need to understand the next step without decoding industry language.',60,616,24,715,C)
a.text('Manrope Regular / 400',63,756,16,M,600)
block(a,'Practical scale','Web: 48-80px hero, 32-40px section title, 20-24px card heading, 16-18px body, 14px label. Print body: generally 10-12pt.',60,848)
block(a,'Fallback and licensing','Use Arial in email. Fonts and license are included. The logo is outlined artwork; never recreate it with ordinary typed text.',480,848)
a=page(9,'Speak like a helpful expert.','Plain language, useful detail and a clear next step.')
block(a,'Primary brand line','Make room for everyday.',60,285,730)
block(a,'Plain-language descriptor','Appliance rentals for the way you live.',60,400,730)
block(a,'For households','Explore appliance rental options for your home. Start with what you need, and ask about availability in your area.',60,523)
block(a,'For property managers','More homes. One partner. Discuss appliance rental needs across your properties.',480,523)
block(a,'Write this way','Lead with the customer need. Explain the offer with short sentences. Use one clear call to action. State actual prices, terms and exclusions near the offer when confirmed.',60,760)
block(a,'Claims require facts','Do not publish “free delivery,” “same-day,” “no credit check,” “maintenance included,” “guaranteed” or “rent-to-own” until the exact offer and policy are verified.',480,760)
a=page(10,'A repeatable visual language.','Large type. Quiet backgrounds. One diagonal accent. Real people and real appliances.')
a.rect(60,285,780,252,E,12);a.text('Make room for everyday.',88,389,49,I,800);a.text('One message. One next step.',92,457,24,I);a.motif(719,416,84,G)
block(a,'Layout','Build on an 8px spacing rhythm online. Keep text left-aligned in most communication. Reserve centered compositions for stacked logos or compact announcements.',60,622)
block(a,'Photography','Use real installed appliances and natural home environments. Show accurate scale, clean surroundings and warm daylight. Avoid fake customer photos or unsupported product depictions.',480,622)
block(a,'Graphic devices','Use the triangular cut as a single corner accent or a low-contrast pattern. It is supporting texture, not a replacement for the logo.',60,850)
block(a,'Icons','Use consistent 2px line icons with rounded ends. The included service icons support navigation; their presence does not promise a service is included.',480,850)
a=page(11,'Social that looks like Robinson.','Use the supplied artwork as a consistent starting point across campaigns.')
for x,bg,t1,t2 in [(60,E,'Make room','for everyday.'),(470,I,'More homes.','One partner.')]:
    a.rect(x,280,370,420,bg,8);a.logo(x+27,315,305,'dark' if bg==E else 'light');a.text(t1,x+27,470,39,I if bg==E else E,800);a.text(t2,x+27,518,39,I if bg==E else E,800);a.rect(x+27,586,216,38,G,6);a.text('Explore your options',x+39,611,16,E,700)
block(a,'Included formats','Square 1080x1080, portrait 1080x1350, vertical 1080x1920, wide cover 1640x624, and website share 1200x630. These are working canvases; preview actual channel cropping.',60,790)
block(a,'Campaign discipline','Start with one audience and one action. Keep prices and conditions readable. Use the editable SVG source for new messages; do not squeeze a long headline into a short layout.',480,790)
a=page(12,'Print with confidence.','The brand system carries from a business card to a large sign.')
a.rect(60,285,380,235,E,6);a.logo(83,340,335,'dark');a.text('Make room for everyday.',87,478,15,I,600)
a.rect(480,285,360,470,W,6);a.logo(506,323,301);a.line(506,429,814,429,S);a.text('Every detail matters.',506,490,25,E,800);a.para('Business documents should feel clear, calm and easy to use.',506,536,17,270,C)
block(a,'Included production sizes','3.5x2in business card, US Letter flyer and letterhead, 6x4in handout, and 24x18in sign. Bleed is included in the card, flyer and handout PDFs.',60,624,355)
a.para('The PDFs preserve vector artwork and include trim/bleed boxes where specified. Colors are RGB masters. Ask the printer to convert with the correct output profile and provide a proof; these are not certified PDF/X or universal CMYK files.',60,880,17,755)
a=page(13,'Recognizable on the move.','Readable identification is more valuable than filling every inch of a vehicle.')
a.rect(60,302,780,270,W,8);a.logo(92,340,712);a.text(DOMAIN,97,527,31,E,700);a.rect(60,550,780,22,E)
block(a,'Vehicle graphics','Use the horizontal logo, service descriptor and website. Supply exact vehicle make, model, year, panel measurements and photos to the installer. Avoid handles, seams, lamps and sight lines.',60,681)
block(a,'Uniforms and fabrication','Use one-color artwork for small embroidery, vinyl cutting and simple screen printing. Ask the vendor to proof small gaps and lettering. Stitch files are machine-specific and are not included.',480,681)
a.para('Included panel artwork is scalable flat art, not a fitted wrap. The concept vehicle image is a visualization only. Do not fabricate from a generated mockup.',60,952,16,745)
a=page(14,'Everyday business, branded.','Make the operational side feel as considered as the marketing.')
block(a,'Customer communication','Use the business signature and email layout. State what happened, what happens next, who needs to act and when. Keep supporting detail beneath the main action.',60,297)
block(a,'Invoices and estimates','Fillable PDF templates support customer details, line items, amounts and terms. They do not calculate totals or connect to accounting. Verify values before sending.',480,297)
block(a,'Work orders','Capture the appliance or asset, requested scope, completion notes and responsible technician. Use your business system for approvals, routing and permanent records.',60,575)
block(a,'Implementation handoff','Copy logo assets and tokens into the website. Keep logos on correct theme backgrounds. Preserve button hierarchy, spacing and readable form states throughout customer and owner views.',480,575)
a.para('Templates with empty fields or {{tokens}} are editing sources. Complete them before external use. No invented phone numbers, addresses, prices or legal terms are embedded in this kit.',60,894,18,755)
a=page(15,'Expand without fragmenting.','Keep one recognizable brand while the business develops new capabilities.')
a.logo(82,300,728)
for idx,name in enumerate(['FOR YOUR HOME','FOR YOUR PROPERTIES','IN YOUR COMMUNITY']):
    a.rect(60,545+idx*103,780,75,W,8);a.text(name,82,592+idx*103,23,E,700,1)
a.para('Treat categories, audiences and regions as supporting headlines, not independent logos. Add new appliance types through photography and copy. Keep the full business descriptor clear. A future move beyond appliance rental would require a deliberate naming decision.',60,925,17,748)
a=page(16,'A kit you can actually use.','Start with the guide, then choose files by job rather than by file extension alone.')
rows=[('01 Logos','Outlined SVG + PDF + transparent PNG masters'),('02 Icons','Avatars, favicon, app icons and web manifest'),('03 Design System','Palette, fonts, tokens, pattern and service icons'),('04 Social / Advertising','Finished graphics plus editable SVG sources'),('05 Print','Cards, flyer, handout, letterhead and sign'),('06 Vehicles / Apparel','Scalable panel and one-color uniform artwork'),('07 Web / Email','Theme CSS, preview, fonts and email layouts'),('08 Business Forms','Fillable invoice, estimate and work order'),('09 Handoff','Copy, production notes, setup and QA record')]
for i,(l,r) in enumerate(rows):
    yy=288+i*69;a.line(60,yy+40,840,yy+40,S);a.text(l,62,yy+13,17,E,700);a.text(r,305,yy+13,15,C)
a.para('This is the v2.0 proposed production identity. The concept board is exploratory visualization; the vector masters are authoritative. Keep v1 separate for reference. Record any future approved changes in the version history.',60,949,16,747)

guide=fitz.open()
for a in pages:
    d=fitz.open('pdf',fitz.open(stream=a.svg().encode(),filetype='svg').convert_to_pdf());guide.insert_pdf(d)
gp=ROOT/'00_Start_Here/Brand-Standards-v2.0.pdf';gp.parent.mkdir(parents=True,exist_ok=True);guide.save(gp)

# Authoritative vector identity overview (not generated mockup).
a=Art(1600,1100,I);a.text('ROBINSON',65,82,18,E,800,2);a.text('A NEW CHAPTER / BRAND SYSTEM V2.0',950,81,15,M,600,1)
a.logo(75,185,840);a.text('Make room for everyday.',77,445,51,E,800);a.para('A confident, green-led identity for the everyday business of home.',79,510,24,810,M)
a.rect(1020,135,510,505,E,20);a.logo(1075,205,400,'dark','stacked')
a.rect(65,669,500,314,E,14);a.logo(104,720,420,'dark');a.text('Appliance rentals.',105,880,34,I,800);a.text('Everyday possibilities.',105,925,34,I,800)
a.rect(603,669,927,314,W,14);a.text('Evergreen. Fresh. Familiar.',638,729,31,E,800)
for idx,(name,col) in enumerate([('EVERGREEN',E),('FRESH',G),('IVORY',I),('INK',C)]):
    xx=638+idx*216;a.rect(xx,775,191,116,col,8);a.text(name,xx,924,12,E,700,1);a.text(col,xx,949,14,M,600)
a.text('TRUE VECTOR MASTERS · LIGHT + DARK · PRINT + DIGITAL · EDITABLE TEMPLATES',67,1051,15,E,600,.5)
save_art(a,'00_Start_Here/Brand-Overview-v2.0',pngw=2000)

# Start here and practical instructions.
write('00_Start_Here/START-HERE.md','''# Robinson Appliance Rentals - Brand Kit v2.0

New proposed identity: Evergreen / Split-R. Created September 29, 2026.

1. Open Brand-Overview-v2.0.pdf for the new visual direction.
2. Read Brand-Standards-v2.0.pdf for the brand rules.
3. Use 01_Logos/horizontal/Robinson-horizontal-light.svg on light backgrounds; use the dark version on evergreen or dark backgrounds.
4. Send SVG or PDF masters to print/sign vendors. PNG is for ordinary image uploads. White logos are transparent and can appear blank in white previews.
5. Install the Manrope static fonts from 07_Web_Email/fonts before editing SVG templates. Use the files ending EDITABLE in a vector editor that supports live SVG text. Outlined files preserve appearance; editable files permit copy changes.
6. Open 07_Web_Email/Web-brand-preview.html locally to inspect light/dark styling. It is a visual specimen, not a live business website.
7. Open 08_Business_Forms PDFs in a PDF form editor to fill customer and job information. Verify amounts; there is no automatic calculation.

## Production status
The native vector logo files are the authoritative v2 masters. The generated concept board is visual exploration, not fabrication artwork. Templates and sizes cover the requested core channels. New channels, offers and vehicle models use the same system but may need new layouts or vendor-specific files. This kit does not imply trademark clearance or guaranteed exclusivity, and it does not automatically replace branding on your live website.

## What is deliberately not invented
No personal phone number, street address, current price, delivery promise, financing policy or legal terms. Business-only artwork is usable as supplied; personalized contact cards and transactional templates need your actual information. The domain follows the supplied v1 kit.

## Practical limits
Print PDFs are vector RGB masters with trim and bleed boxes where relevant, not PDF/X-certified CMYK files. Exact material colors, wraps, embroidery digitization and production tolerances require the selected vendor's proof. The 6x4 handout is not a postal-layout template. No software backend, accounting integration, automated totals or email delivery service is included.
''')
write('09_Handoff/Production-and-vendor-notes.md','''# Production and vendor handoff

## Artwork
All logo SVGs consist of paths. PDF masters are vector. PNGs are transparent unless the artwork has an intentional background. Choose a high-contrast variant. Artwork is supplied in sRGB using exact hex definitions in brand-tokens.json. Do not sample colors from screenshots or the concept board.

## Print dimensions
Business cards: 3.5 x 2in trim; PDF page 3.75 x 2.25in including 0.125in bleed on each edge. Flyer: 8.5 x 11in trim; PDF page 8.75 x 11.25in. Handout: 6 x 4in trim; PDF page 6.25 x 4.25in. Relevant PDFs have TrimBox and BleedBox. Letterhead is 8.5 x 11in, no bleed. Sign is 24 x 18in, no bleed; ask vendor about finishing allowance. Keep critical content at least 0.125in inside trim; templates use more where practical.

Use printer-specified ICC conversion and request a hard proof, especially for deep evergreen and bright fresh green. No Pantone match or universal CMYK equivalence is asserted. Select physical vinyl/thread/ink swatches with the vendor. Do not use automatic RGB-to-CMYK formulas as approved color standards. Large signs may need substrate/finishing margins beyond supplied artwork.

## Vehicles
24 x 8in and 10 x 10in flat-art panels are dimensional starting points. Do not order a wrap from these dimensions without measuring. Installer must adapt to the exact vehicle template and avoid handles, seams, windows, lights and safety markings. A wrap-production file is not included because the vehicle model and measurements are unknown.

## Apparel
One-color vector masters are provided. Chest-mark art has a 3in canvas; uniform-back art has an 11in canvas. Production width refers to visible artwork, which has internal canvas padding. Vendor must digitize embroidery for actual material and machine, assess minimum column/gap widths, and sew a proof. Do not convert the SVG directly to a stitch file without digitizing review.

## Editing
Install Manrope. Edit *-EDITABLE.svg text in a vector editor. Check line breaks and all edges after changing copy. Export an outlined copy before sending to vendors. Master logo paths should not change. Keep outlines and editable sources as paired files. The supplied build script can regenerate all assets but ordinary text changes do not require coding.

## Proof checklist
Correct spelling and URL; correct dimensions; logo clear space; legible descriptor; no cropped headlines; actual phone/address if added; correct front/back orientation; confirmed pricing/terms; material proof; safe trim and finishing margins.
''')
write('09_Handoff/Marketing-copy-and-message-bank.md','''# Messaging library

## Positioning
Robinson Appliance Rentals helps households and property managers explore appliance rental options with clear information and a practical next step. Treat this as intended positioning, not proof of an operational service promise.

Primary brand line: **Make room for everyday.**
Plain descriptor: **Appliance rentals for the way you live.**
Household headline: **Your home. Your next chapter.**
Property headline: **More homes. One partner.**
Product-page headline: **Find the right fit for your home.**
Service message: **A clear next step starts with a conversation.**

## Homepage copy
Make room for everyday.
Explore appliance rental options for your home. Start with what you need, and let us help you find your next step.
CTA: Explore rental options
Secondary CTA: Ask about availability

## Property managers
More homes. One partner.
Discuss appliance rental needs across your properties with Robinson Appliance Rentals.
CTA: Discuss your properties

## Social captions
1. A new home comes with a long list. Explore appliance rental options with Robinson Appliance Rentals. Visit robinsonappliancerentals.com to start the conversation.
2. Looking into appliance rentals for a rental property? Tell us what you need and ask about availability. robinsonappliancerentals.com
3. Make room for everyday. Explore options for your home's next chapter at robinsonappliancerentals.com.

## Short business description
Robinson Appliance Rentals offers a place to explore appliance rental options for homes and rental properties. Visit our website to learn about current options and availability.

## Email subject lines
Your appliance rental inquiry
Your estimate from Robinson Appliance Rentals
An update on your appliance request
Your next step with Robinson

## Claims and variable information
Check all claims against actual business policy. Add geography, products, current rates, contract length, delivery, installation, maintenance and rent-to-own details only after verification. Keep geography outside the permanent logo so new service areas can use the same identity. Do not imply the green palette means an environmental certification.
''')
write('09_Handoff/Website-and-Claude-handoff.md','''# Implementation handoff

Apply the v2 brand system to the existing Robinson Appliance Rentals website and portals. This is a visual-system handoff, not authorization to deploy or change business rules.

1. Preserve routes, permissions, prices, integrations and business logic. Replace old branding intentionally in a separate reviewed change.
2. Put horizontal light/dark SVGs, favicon, icons and manifest under a stable /brand path. Set a meaningful logo alt label, intrinsic dimensions and appropriate responsive sizing. Do not put the full logo in a favicon.
3. Import brand.css and load the included Manrope web font. Use brand-tokens.json as the color source. Add semantic error/warning/success states with text labels; do not reuse a decorative green accent for every state.
4. Persist the visitor's light/dark choice, fall back to their system preference, and avoid theme flash. The static preview uses a toggle only; implement persistence in the app.
5. Keep the public site welcoming: ivory surfaces, evergreen headers, readable text, fresh-green accents and one dominant next action. Show actual products and truthful availability.
6. Keep owner/customer portals calm: page title, one primary action, searchable data, consistent forms, useful empty/error/loading states. Never encode status by color alone.
7. Use outlined logo masters. Template live text is for marketing edits, not logo regeneration. Header logo width should preserve the descriptor; use the standalone mark only when the business name is already present nearby.
8. Apply the favicon, social-share image, manifest and email brand. Set accurate metadata and structured data from verified business information; do not invent reviews, ratings, addresses or service areas.
9. Check mobile, zoom, keyboard focus, contrast, long names, empty states and real content. Theme tokens are starting values, not an assertion that the entire application is accessible.
10. Present the completed preview before production deployment. Record branding version 2.0 in project documentation.

The included web preview demonstrates appearance; it does not implement bookings, pricing, inventory, accounts or messaging. No live website has been modified by this kit.
''')
write('07_Web_Email/EMAIL-SETUP.md','''# Email setup
Email-signature.html is a business-only signature using live text and no externally hosted images. Copy its rendered contents into your email client's signature editor. Add a verified personal name, job title and phone if desired.

Customer-email-EDITABLE.html is a reusable transactional layout. Replace every {{token}} with verified content. Escape inserted text and validate URLs in your sending system. Confirm contact details, links and purpose before sending. It has no email-delivery integration. If adapted for promotional campaigns, add the footer and subscription-management elements required by your mailing platform and applicable rules. Test rendering in your actual email clients; dark-mode inversion differs by client.
''')
write('08_Business_Forms/READ-ME.md','''# Business forms
These PDFs contain real fillable form fields. Open them in a PDF reader with AcroForm support. Complete the business details, customer details and document fields, then save a copy per customer/job. Blank fields are intentional editing areas.

The invoice and estimate totals are manually entered. They do not calculate or establish pricing, tax treatment, contract terms or account balances. Verify every figure before sending. Estimates are not rental agreements. The work order does not replace a contract or authorization workflow. No payment link or banking information is invented. Keep completed customer records in your business system, not in the public brand assets folder.
''')

# Include concept only as explicitly separated inspiration.
concept=BASE/'generated_images/exec-7d3b8f23-5e32-4344-8f85-808256145468.png'
if concept.exists():
    (ROOT/'10_Concept_Visualization').mkdir(exist_ok=True);shutil.copy(concept,ROOT/'10_Concept_Visualization/Initial-concept-board-NOT-production.png')
    write('10_Concept_Visualization/READ-ME.md','The initial concept was generated with the built-in image-generation tool, then refined into the exact native vector masters supplied in 01_Logos. This board is inspiration and a rough application visualization, not source artwork. The wordmark and details may differ from the refined vector system. Never print a logo cropped from this board.\n')

# Deterministic vector and form QA, contrast values, inventory.
def lum(h):
    vals=[int(h[i:i+2],16)/255 for i in [1,3,5]];v=[x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in vals]
    return .2126*v[0]+.7152*v[1]+.0722*v[2]
def contrast(a,b):v=sorted([lum(a),lum(b)]);return (v[1]+.05)/(v[0]+.05)
pairs=[('White on evergreen',W,E),('Ink on ivory',C,I),('Evergreen on fresh',E,G),('Muted on ivory',M,I),('Ivory on night',I,D),('Dark muted on surface','#B7C8BB','#152E22')]
qa=['# Build verification','',f'Guide: {len(pages)} pages.','', '## Calculated color-pair contrast','', '| Pair | Ratio |','|---|---:|']
for name,f,b in pairs:qa.append(f'| {name} | {contrast(f,b):.2f}:1 |')
qa+=['','These are mathematical sRGB pair checks, not an audit of a deployed interface.','', '## Form structure']
for p in sorted((ROOT/'08_Business_Forms').glob('*.pdf')):
    fields=PdfReader(p).get_fields();assert fields;qa.append(f'- {p.name}: {len(fields)} fillable fields.')
for p in (ROOT/'01_Logos').rglob('*.svg'):
    s=p.read_text();assert '<image' not in s and '<text' not in s
qa+=['','Logo SVGs checked for no raster embeds and no live text. Print PDF dimensions and trim boxes are present where specified. Rendered visual review is recorded in the final delivery note.','', 'Not performed: trademark/name clearance, press proof, vehicle fit, embroidery sew-out, live-site or email-client testing.']
write('09_Handoff/QA-and-contrast-record.md','\n'.join(qa)+'\n')
shutil.copy(__file__,ROOT/'09_Handoff/build_kit.py')
write('09_Handoff/Regeneration.md','''# Optional regeneration
The included Python source records the exact geometry and template construction. Routine design edits should use the EDITABLE SVG files. To run the script in a new environment, set BASE to a working folder, put the bundled Manrope-Variable.ttf at work/fonts/Manrope.ttf and OFL.txt at work/fonts/Manrope-OFL.txt, and install fonttools[woff], PyMuPDF, Pillow, reportlab and pypdf. Run with Python 3. The concept image is optional. The generated kit goes to output/Robinson_Appliance_Rentals_Brand_Kit_v2.0. This is an authoring source, not a business application.
''')
print(json.dumps({'root':str(ROOT),'files':len(list(ROOT.rglob('*'))),'guide_pages':len(pages)},indent=2))
