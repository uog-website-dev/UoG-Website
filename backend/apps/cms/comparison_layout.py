"""Construct the AAU comparison using only the shared, versioned 43-widget contract."""
from html import escape


def comparison_layout(manifest, assets):
    serial=0
    def identity(kind):
        nonlocal serial
        serial+=1
        return f'aau-{kind}-{serial}'
    def node(kind,style=None,**props):
        value={'id':identity(kind),'type':kind,'props':props}
        if style:value['style']=style
        return value
    def heading(value):return node('headline',text=value,level=2,style={'text_size':'md'})
    def text(value):return node('editor',html='<p>'+escape(value)+'</p>')
    def button(label,href):return node('button',label=label,href=href,variant='solid')
    def section(children,**style):
        return {'id':identity('section'),'type':'section','ratios':[100],'style':{'content_width':'wide','padding':'md',**style},'columns':[{'id':identity('column'),'type':'column','children':children}]}
    def hero(key,title,copy,href,label,mode='split',background='mist'):
        return node('hero_image',asset_id=assets[key],alt=manifest['assets'][key]['alt'],title=title,text=copy,
                    layout=mode,height='medium',mask='curve' if mode=='split' else 'none',
                    actions=[{'id':identity('action'),'label':label,'href':href}],style={'background':background,'text_color':'inverse' if background=='navy' or mode=='overlay' else 'default'})
    def carousel(children,navigation='overlay',seconds=0):
        return node('layout_slider',items=[{'id':identity('slide'),'children':[child]} for child in children],navigation=navigation,autoplay_seconds=seconds)
    rows=[section([node('alert',text='AAU comparison: public reference content imported for a local CMS capability review. Original articles remain on aau.edu.et.',severity='info')],padding='sm')]
    rows.append(section([carousel([
        hero('gate-min','Seek Wisdom, Elevate Your Intellect and Serve Humanity','Learning, discovery and public service at Addis Ababa University.','http://admission.aau.edu.et/','Study at AAU'),
        hero('research','Research that makes a difference','Explore research and scholarship across disciplines.','https://aau.edu.et/research','Explore research'),
        hero('gerdLanding','Connecting industry and innovation','Academic partnerships connect knowledge with practical challenges.','https://aau.edu.et/publications','Publications'),
        hero('tashLight1','Excellence in clinical care','Explore clinical services and health-science education.','https://aau.edu.et/services','View services'),
    ],seconds=8)],content_width='full',padding='none'))
    rows.append(section([heading('Our Impact in Numbers'),node('features',columns=4,presentation='statistics',items=[
        {'id':identity('stat'),'title':'AAU Notable Alumni','text':'Explore the original alumni directory at aau.edu.et.'},
        {'id':identity('stat'),'title':'#1','text':'East Africa university ranking\nSource: AAU statistics / QS'},
        {'id':identity('stat'),'title':'280 K+','text':'All Time Graduates\nSource: AAU statistics'},
        {'id':identity('stat'),'title':'12 K+','text':'Research outputs\nSource: AAU statistics'},
    ]),button('View source statistics','https://aau.edu.et/statistics')],align='center'))
    rows.append(section([node('button_grid',items=[{'id':identity('quick'),'label':label,'href':href} for label,href in [('Library','https://aau.edu.et/library'),('E-learning','https://courses.aau.edu.et/'),('Campus life','#campus-life'),('Alumni','https://alumni.aau.edu.et/'),('Meet our staff','https://aau.edu.et/staffs')]])],align='center'))
    rows.append(section([node('menu_anchor',anchor='campus-life'),carousel([
        hero('forumbuilding','Campus life','Explore student activities, facilities and the university community.','https://aau.edu.et/campus_life','Explore campus life','overlay','navy'),
        hero('kennedy1-min','Learning and discovery','Libraries, museums and spaces for teaching and collaboration.','https://aau.edu.et/library','Explore the library','overlay','navy'),
    ])],content_width='full',padding='none'))
    rows.append(section([node('image_grid',items=[{'id':identity('life-image'),'asset_id':assets[key],'alt':manifest['assets'][key]['alt'],'caption':caption} for key,caption in [('freshers','Student events and activities'),('recreationAndsports','Recreation and sport'),('alamoudi','Learning facilities')]])]))
    rows.append(section([heading("What's New"),node('loop_grid',source='posts',limit=4,category='news',presentation='featured'),button('View more news','/posts/categories/news')]))
    rows.append(section([heading('Explore our Campuses'),carousel([hero(campus['image'],campus['name'],'Explore this AAU campus and follow the source for current programme and contact details.','https://aau.edu.et/campuses','Explore this campus','split_reverse','navy') for campus in manifest['campuses']])],content_width='full',background='navy',text_color='inverse',padding='lg'))
    partner_items=[]
    for partner in manifest['partners']:
        partner_items.append({'id':identity('partner'),'children':[
            node('image',asset_id=assets[partner['image']],alt=partner['title']+' logo',style={'image_fit':'contain','image_height':'compact'}),
            heading(partner['title']),text('Featured in the AAU partner directory. Follow the original source for the current partnership description.'),button('View original partner directory','https://aau.edu.et/partners')]})
    rows.append(section([heading('Featured partners'),node('anything_carousel',items=partner_items,navigation='thumbnails',autoplay_seconds=0)],background='mist',align='center'))
    rows.append(section([heading('Announcements'),node('loop_grid',source='posts',limit=5,category='announcements',presentation='list'),button('View all announcements','/posts/categories/announcements')]))
    rows.append(section([text('Comparison source: https://aau.edu.et/ — captured 22 November 2026. Images retain their original AAU attribution; article summaries are shortened and link to their sources. Imported publication dates show the local CMS release time, while original dates are retained in each article.')]))
    return {'schema_version':1,'settings':{'show_title':False,'content_width':'full'},'rows':rows}
