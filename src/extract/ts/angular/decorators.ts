import ts from 'typescript';
import type { IrClassifier } from '../../../ir/irV1';
import { decoratorCallName, getDecoratorArgObject, getDecorators, readStringProp } from './util';

export type AngularDecoratorInfo = {
  isComponent: boolean;
  isInjectable: boolean;
  isNgModule: boolean;
  componentSelector?: string;
  componentTemplateUrl?: string;
};

export function detectAngularDecorators(node: ts.ClassDeclaration, sf: ts.SourceFile): AngularDecoratorInfo {
  const decorators = getDecorators(node);
  const decNames = decorators.map((d) => decoratorCallName(d, sf)).filter(Boolean) as string[];

  const isComponent = decNames.includes('Component');
  const isInjectable = decNames.includes('Injectable');
  const isNgModule = decNames.includes('NgModule');

  let componentSelector: string | undefined;
  let componentTemplateUrl: string | undefined;

  if (isComponent) {
    const d = decorators.find((dd) => decoratorCallName(dd, sf) === 'Component');
    const obj = d ? getDecoratorArgObject(d) : undefined;
    if (obj) {
      componentSelector = readStringProp(obj, 'selector', sf);
      componentTemplateUrl = readStringProp(obj, 'templateUrl', sf);
    }
  }

  return { isComponent, isInjectable, isNgModule, componentSelector, componentTemplateUrl };
}

export type ClassifierTagger = {
  addStereo: (c: IrClassifier, name: string) => void;
  setTag: (c: IrClassifier, key: string, value: string) => void;
};

export function applyAngularClassifierDecoration(c: IrClassifier, info: AngularDecoratorInfo, tagger: ClassifierTagger) {
  if (info.isComponent || info.isInjectable || info.isNgModule) tagger.setTag(c, 'framework', 'angular');

  if (info.isComponent) {
    c.kind = 'COMPONENT';
    tagger.addStereo(c, 'AngularComponent');
    tagger.setTag(c, 'angular.decorator', 'Component');
    if (info.componentSelector) tagger.setTag(c, 'angular.selector', info.componentSelector);
    if (info.componentTemplateUrl) tagger.setTag(c, 'angular.templateUrl', info.componentTemplateUrl);
  }

  if (info.isInjectable) {
    c.kind = 'SERVICE';
    tagger.addStereo(c, 'AngularInjectable');
    tagger.setTag(c, 'angular.decorator', 'Injectable');
  }

  if (info.isNgModule) {
    c.kind = 'MODULE';
    tagger.addStereo(c, 'AngularNgModule');
    tagger.setTag(c, 'angular.decorator', 'NgModule');
  }
}
