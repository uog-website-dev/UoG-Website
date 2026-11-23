import copy
import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.core.exceptions import ValidationError
from apps.cms.comparison_layout import comparison_layout
from apps.cms.layout_contract import validate_layout


def fixture():
    names=['gate-min','research','gerdLanding','tashLight1','forumbuilding','kennedy1-min','freshers','recreationAndsports','alamoudi','campus-0','partner-0']
    assets={name:'00000000-0000-4000-8000-000000000001' for name in names}
    manifest={'assets':{name:{'alt':'Reference campus photograph'} for name in names},'campuses':[{'image':'campus-0','name':'Reference campus'}],'partners':[{'image':'partner-0','title':'Reference partner'}]}
    return comparison_layout(manifest,assets)


def test_comparison_is_a_valid_shared_builder_document():
    value=validate_layout(fixture())
    assert len(value['rows'])==11
    assert value['settings']['content_width']=='full'
    assert value['rows'][1]['columns'][0]['children'][0]['props']['navigation']=='overlay'


@pytest.mark.parametrize('field,value',[('navigation','external-script'),('autoplay_seconds',1),('autoplay_seconds',1000)])
def test_unapproved_carousel_options_are_rejected_with_paths(field,value):
    layout=fixture();layout['rows'][1]['columns'][0]['children'][0]['props'][field]=value
    with pytest.raises(ValidationError) as error:validate_layout(layout)
    assert field in str(error.value)


def test_feature_columns_are_bounded_and_legacy_props_still_validate():
    layout=fixture();features=layout['rows'][2]['columns'][0]['children'][1]['props']
    features['columns']=5
    with pytest.raises(ValidationError):validate_layout(layout)
    del features['columns'];del features['presentation']
    assert validate_layout(layout)


def test_importer_cannot_run_outside_development(settings):
    settings.DEBUG=False
    with pytest.raises(CommandError,match='development-only'):
        call_command('import_aau_comparison',directory='/missing',site=1,actor='none')


@pytest.mark.parametrize('field,value',[('pattern','url(javascript:alert(1))'),('panel_tone','custom-css'),('media_ratio',99),('heading_level',5),('heading_color','red;position:fixed'),('curve_border','url(x)'),('curve_border_width',100)])
def test_hero_appearance_tokens_are_allowlisted(field,value):
    layout=fixture();hero=layout['rows'][1]['columns'][0]['children'][0]['props']['items'][0]['children'][0]
    hero['props'][field]=value
    with pytest.raises(ValidationError):validate_layout(layout)


def test_shared_hero_and_horizontal_news_options_validate_together():
    layout=fixture();slider=layout['rows'][1]['columns'][0]['children'][0]
    slider['props']['height']='tall'
    hero=slider['props']['items'][0]['children'][0]
    hero['props'].update(pattern='waves',panel_tone='brand_gradient',media_ratio=60,curve_border='gold',curve_border_width=8,heading_level=1,heading_size='xl',heading_color='white',heading_weight='heavy',heading_case='uppercase',text_align='center',body_size='lg')
    news=layout['rows'][6]['columns'][0]['children'][1]
    assert news['type']=='loop_grid'
    news['props'].update(display='slider',columns=4,image_hover='zoom')
    assert validate_layout(layout)==layout

def test_hero_cards_are_bounded_validated_and_in_publication_inventory(monkeypatch):
    from apps.cms.layout_contract import validate_layout_media
    from apps.cms.services.visual_publication import references
    layout=fixture();hero=layout['rows'][1]['columns'][0]['children'][0]['props']['items'][0]['children'][0]
    card={'id':'campus-card','asset_id':'00000000-0000-4000-8000-000000000002','alt':'Students','title':'Campus life','text':'Discover our community.','label':'Explore','href':'/campus'}
    hero['props']['items']=[card]
    assert validate_layout(layout)==layout
    assert any(asset==card['asset_id'] and '.props.items[0].asset_id' in path for asset,path in references(layout))
    seen=[]
    monkeypatch.setattr('apps.cms.blocks.check_image_ref',lambda ref,**kwargs:seen.append(ref))
    validate_layout_media(layout,site_id=12)
    assert 'sites/12/assets/'+card['asset_id'] in seen
    hero['props']['items']=[card,dict(card,id='second'),dict(card,id='third')]
    with pytest.raises(ValidationError):validate_layout(layout)
    hero['props']['items']=[dict(card,href='javascript:alert(1)')]
    with pytest.raises(ValidationError):validate_layout(layout)

@pytest.mark.django_db
def test_hero_card_images_are_extracted_by_database_reference_inventory():
    import json
    from django.db import connection
    layout=fixture();hero=layout['rows'][1]['columns'][0]['children'][0]['props']['items'][0]['children'][0]
    hero['props']['items']=[{'id':'card-photo','asset_id':'00000000-0000-4000-8000-000000000002'}]
    with connection.cursor() as cursor:
        cursor.execute('SELECT media_effective_blocks(%s::jsonb)',[json.dumps({'site_id':12,'metadata':{'visual_layout':layout}})])
        value=cursor.fetchone()[0]
    if isinstance(value,str):value=json.loads(value)
    assert any(block.get('type')=='visual_media_items' and block['items'][0]['id']=='card-photo' for block in value)
