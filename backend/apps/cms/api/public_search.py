"""Host-scoped search over latest publication snapshots, never current private drafts."""
from django.db.models import OuterRef,Subquery,Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.views import APIView
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from apps.sites.api.serializers import StrictFields
from apps.sites.selectors.modules import module_is_available
from ..models import PublishedContentSnapshot
from ..selectors.pages import public_pages
from ..selectors.posts import published_posts
from .public import _resolved_site,_locale

class SearchQuery(StrictFields,serializers.Serializer):
    q=serializers.CharField(min_length=2,max_length=100)
    page=serializers.IntegerField(min_value=1,max_value=10000,default=1)
    page_size=serializers.IntegerField(min_value=1,max_value=20,default=10)
    def to_internal_value(self,data):
        if hasattr(data,'getlist') and any(len(data.getlist(key))!=1 for key in data):
            raise serializers.ValidationError({'query':'Supply each parameter once.'})
        return super().to_internal_value(dict(data.items()))
class SearchResult(serializers.Serializer):
    title=serializers.CharField()
    href=serializers.CharField()
    kind=serializers.ChoiceField(choices=('page','post'))
class SearchOutput(serializers.Serializer):
    site=serializers.IntegerField()
    count=serializers.IntegerField()
    page=serializers.IntegerField()
    page_size=serializers.IntegerField()
    results=SearchResult(many=True)
class PublicSearch(APIView):
    authentication_classes=[]
    permission_classes=[AllowAny]
    def finalize_response(self,request,response,*args,**kwargs):
        response=super().finalize_response(request,response,*args,**kwargs)
        response['Cache-Control']='private, no-store'
        response['Vary']='Host'
        return response
    @extend_schema(tags=['Public search'],parameters=[SearchQuery],responses=SearchOutput,description='Search latest eligible Page/Post publication titles and article excerpts under the trusted hostname. No Site override. Bounded deterministic pagination; disabled modules and drafts are excluded.')
    def get(self,request):
        site=_resolved_site(request)
        query=SearchQuery(data=request.query_params);query.is_valid(raise_exception=True);values=query.validated_data
        locale=_locale(site,None)
        eligible=Q(pk__in=[])
        if module_is_available(site.pk,'PAGES'):eligible|=Q(content_id__in=public_pages(site.pk,locale).values('pk'))
        if module_is_available(site.pk,'POSTS'):eligible|=Q(content_id__in=published_posts(site.pk,locale).order_by().values('pk'))
        latest=PublishedContentSnapshot.objects.filter(content_id=OuterRef('content_id')).order_by('-version')
        rows=PublishedContentSnapshot.objects.filter(eligible,content__site_id=site.pk,pk=Subquery(latest.values('pk')[:1]),published_at__lte=timezone.now()).filter(Q(payload__title__icontains=values['q'])|Q(payload__excerpt__icontains=values['q'])).order_by('-published_at','-content_id')
        count=rows.count();start=(values['page']-1)*values['page_size'];results=[]
        for snapshot in rows.only('payload')[start:start+values['page_size']]:
            payload=snapshot.payload;kind='post' if payload.get('content_type')=='api.post' else 'page'
            href=f"/posts/{payload['slug']}" if kind=='post' else payload.get('path')
            if isinstance(href,str) and href.startswith('/') and not href.startswith('//'):results.append({'title':payload['title'],'href':href,'kind':kind})
        return Response({'site':site.pk,'count':count,'page':values['page'],'page_size':values['page_size'],'results':results},headers={'Cache-Control':'private, no-store','Vary':'Host'})
