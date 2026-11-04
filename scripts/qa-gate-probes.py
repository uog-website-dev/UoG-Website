"""Additional real-HTTP acceptance assertions; reuse the run's private credentials."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

source = Path('/tmp/qa-gate-rerun.py').read_text().split('\ntry:\n    if set(sys.argv)')[0]
exec(compile(source, 'qa-http-helpers', 'exec'))
previous = json.loads(Path('/tmp/qa-gate-results.json').read_text())
state, results = previous['state'], previous['results']
events = json.loads(Path('/tmp/qa-gate-requests.json').read_text())
run = state['run']
actors.update(json.loads(secret_path.read_text())['actors'])
for principal in actors.values():
    fresh = http('http://keycloak:8080/realms/uog/protocol/openid-connect/token', 'POST', form={
        'grant_type': 'password', 'client_id': 'backend-api',
        'client_secret': env['KEYCLOAK_BACKEND_API_SECRET'],
        'username': principal['username'], 'password': principal['password'],
    })
    assert fresh[0] == 200
    principal.update(fresh[1])
site = state['sites'][0]
for route in ('schema', 'docs', 'redoc'):
    response = http('http://nginx/api/' + route + '/', host='localhost')
    events.append({'path': '/api/' + route + '/', 'method': 'GET', 'status': response[0],
                   'content_type': response[2].get('Content-Type'), 'actor': 'anonymous'})
    mark('T33', response[0] == 200, f'Actual /api/{route}/ returned {response[0]}.')
menu = next(event['response'] for event in events if event['path'] == site['url'] + 'menus/'
            and event['method'] == 'POST' and event['status'] == 201)
need(site['url'] + 'menus/', 'POST', {'name': 'QA Inactive Footer', 'location': 'footer'}, 'siteadmin')
inventory = items(need(site['url'] + 'menus/', actor='siteadmin')[1])
explicit_active = items(need(site['url'] + 'menus/?is_active=true', actor='siteadmin')[1])
inactive = items(need(site['url'] + 'menus/?is_active=false', actor='siteadmin')[1])
mark('T28', menu['id'] in [row['id'] for row in inventory] and len(inventory) == 2
     and [row['id'] for row in explicit_active] == [menu['id']]
     and len(inactive) == 1 and inactive[0]['location'] == 'footer',
     f"Unfiltered menu inventory contains active and inactive menus={len(inventory)==2}; activated menu visible={menu['id'] in [r['id'] for r in inventory]}; explicit true count={len(explicit_active)}, false count={len(inactive)}.")
url = site['url'] + f"menus/{menu['id']}/"
need(url + 'items/', 'POST', {'label': 'QA Inactive item', 'item_type': 'custom',
     'target': '/qa-home', 'is_active': False}, 'siteadmin', etag=tag(url, 'siteadmin'))
for endpoint in (site['url'] + 'menus/', url + 'items/'):
    all_rows = need(endpoint, actor='siteadmin')[1]
    active_rows = need(endpoint + '?is_active=true', actor='siteadmin')[1]
    inactive_rows = need(endpoint + '?is_active=false', actor='siteadmin')[1]
    mark('T28', all_rows['count'] == active_rows['count'] + inactive_rows['count']
         and active_rows['count'] > 0 and inactive_rows['count'] > 0,
         f"{endpoint}: omitted filter count={all_rows['count']}, active={active_rows['count']}, inactive={inactive_rows['count']}.")
    for query in ('is_active=invalid', 'is_active=', 'is_active=true&is_active=false'):
        invalid = api(endpoint + '?' + query, actor='siteadmin')
        mark('T34', invalid[0] == 400 and 'request_id' in invalid[1],
             f'{endpoint}?{query} rejected with structured HTTP {invalid[0]}.')
    first_page = need(endpoint + '?page_size=1', actor='siteadmin')[1]
    second_page = need(endpoint + '?page_size=1&page=2', actor='siteadmin')[1]
    mark('T28', first_page['count'] == all_rows['count'] and first_page['results'][0]['id'] != second_page['results'][0]['id'],
         f'{endpoint}: unfiltered pagination retains total count and distinct ordered rows.')
tree = need(url + 'tree/', actor='siteadmin')[1]['items']
home = next(row for row in tree if row['label'] == 'QA Home')
child = next(row for row in tree if row['label'] == 'QA Child')
cycle = api(url + f"items/{home['id']}/move/", 'POST', {'parent': child['id'], 'position': 0}, 'siteadmin', etag=tag(url, 'siteadmin'))
mark('T29', cycle[0] == 400 and 'invalid_tree' in json.dumps(cycle[1]),
     f'Live descendant-parent move rejected with typed invalid_tree, HTTP {cycle[0]}.')
roots = [row['id'] for row in tree if row['parent'] is None]
if len(roots) < 3:
    extra = need(url + 'items/', 'POST', {'label': 'QA concurrency sentinel', 'item_type': 'custom',
                 'target': '/qa-home', 'is_active': False}, 'siteadmin', etag=tag(url, 'siteadmin'))[1]
    roots.append(extra['id'])
version = tag(url, 'siteadmin')
barrier = Barrier(2)
def reorder(order):
    barrier.wait(timeout=10)
    return http('http://nginx' + url + 'reorder/', 'POST', {'parent': None, 'items': order},
                actors['siteadmin']['access_token'], host='localhost', etag=version)
with ThreadPoolExecutor(max_workers=2) as pool:
    # Both requests must change the order: a no-op is allowed to retain its ETag.
    futures = [pool.submit(reorder, roots[1:] + roots[:1]), pool.submit(reorder, roots[2:] + roots[:2])]
    responses = [future.result(timeout=60) for future in futures]
for response in responses:
    events.append({'path': url + 'reorder/', 'method': 'POST', 'test': 'simultaneous same-version reorders',
                   'status': response[0], 'response': response[1]})
mark('T29', sorted(response[0] for response in responses) == [200, 409],
     'Simultaneous real HTTP reorder requests with one ETag returned ' + str([r[0] for r in responses]) + '.')
probe_globals = []
for module in items(need('/api/v1/modules/')[1]):
    if module['code'] in {'PAGES', 'POSTS', 'MENUS'} and not module['is_enabled']:
        global_url = f"/api/v1/modules/{module['id']}/"
        patch(global_url, {'is_enabled': True})
        probe_globals.append(global_url)
for code, collection in (('PAGES', 'pages'), ('POSTS', 'posts'), ('MENUS', 'menus')):
    module_url = site['url'] + f"modules/{site['module_ids'][code]}/"
    action(module_url, 'disable')
    try:
        denied = api(site['url'] + collection + '/', actor='siteadmin')
        if code == 'MENUS':
            mutation = api(url, 'PATCH', {'name': 'Must not edit disabled menu'}, 'siteadmin', etag=tag(url, 'siteadmin'))
            mark('T11', mutation[0] == 400 and 'module_disabled' in json.dumps(mutation[1]),
                 f'Disabled MENUS retains authorized reads ({denied[0]}) and rejects editing with module_disabled ({mutation[0]}).')
        else:
            mark('T11', denied[0] in (403, 404), f'Disabled {code} denies protected inventory: HTTP {denied[0]}.')
    finally:
        action(module_url, 'enable')
for global_url in probe_globals:
    patch(global_url, {'is_enabled': False})
anonymous = api(site['url'] + 'pages/', 'POST', {'title': 'Anonymous must not create', 'slug': 'anonymous-denied'}, actor=None)
mark('T17', anonymous[0] == 401, f'Anonymous write denied with HTTP {anonymous[0]}.')
save()
raise SystemExit(1 if any(not row['pass'] and not row.get('excluded_reason') for rows in results.values() for row in rows) else 0)
