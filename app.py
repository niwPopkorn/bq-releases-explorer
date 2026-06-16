import os
import time
import requests
import xml.etree.ElementTree as ET
from flask import Flask, render_template, jsonify, request

app = Flask(__name__)

# Cache store
feed_cache = {
    'data': None,
    'last_updated': 0
}

CACHE_DURATION = 600  # 10 minutes in seconds
FEED_URL = "https://docs.cloud.google.com/feeds/bigquery-release-notes.xml"

def fetch_and_parse_feed():
    try:
        response = requests.get(FEED_URL, timeout=15)
        response.raise_for_status()
    except Exception as e:
        return {"error": f"Failed to fetch feed: {str(e)}"}
    
    try:
        root = ET.fromstring(response.content)
        ns = {'atom': 'http://www.w3.org/2005/Atom'}
        
        entries = []
        for entry in root.findall('atom:entry', ns):
            id_val = entry.find('atom:id', ns)
            id_str = id_val.text if id_val is not None else ""
            
            title_val = entry.find('atom:title', ns)
            title_str = title_val.text if title_val is not None else ""
            
            updated_val = entry.find('atom:updated', ns)
            updated_str = updated_val.text if updated_val is not None else ""
            
            # Find link with rel='alternate' or any link if not found
            link_val = entry.find("atom:link[@rel='alternate']", ns)
            if link_val is None:
                link_val = entry.find("atom:link", ns)
            link_str = link_val.attrib.get('href', '') if link_val is not None else ""
            
            content_val = entry.find('atom:content', ns)
            content_str = content_val.text if content_val is not None else ""
            
            entries.append({
                'id': id_str,
                'title': title_str,
                'updated': updated_str,
                'link': link_str,
                'content': content_str
            })
            
        return {"status": "success", "entries": entries}
    except Exception as e:
        return {"error": f"Failed to parse XML: {str(e)}"}

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/releases')
def get_releases():
    force_refresh = request.args.get('refresh', 'false').lower() == 'true'
    now = time.time()
    
    if force_refresh or not feed_cache['data'] or (now - feed_cache['last_updated']) > CACHE_DURATION:
        res = fetch_and_parse_feed()
        if 'error' in res:
            if feed_cache['data']:
                return jsonify({
                    **feed_cache['data'],
                    "warning": f"Using cached data due to refresh failure: {res['error']}"
                })
            return jsonify(res), 500
        
        feed_cache['data'] = res
        feed_cache['last_updated'] = now
        
    return jsonify(feed_cache['data'])

if __name__ == '__main__':
    app.run(debug=True, port=5000)
