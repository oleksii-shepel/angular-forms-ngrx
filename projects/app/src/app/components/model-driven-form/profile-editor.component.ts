import { Component, Output, EventEmitter, ViewChild, OnDestroy } from '@angular/core';
import { NgForm } from '@angular/forms';
import { Profile, initialModel } from '../../models/profile';
import { Store } from '@ngrx/store';
import { ApplicationState, getModelSlice } from '../../reducers';
import { take, Observable } from 'rxjs';
import { InitForm, UpdateFormValue, deepClone, getValue } from 'ngync';
import { ModelState, initialState } from '../../reducers/standard.reducer';

@Component({
  selector: 'standard-profile-editor',
  templateUrl: './profile-editor.component.html',
  styleUrls: ['./profile-editor.component.css'],
})
export class StandardProfileEditorComponent implements OnDestroy {
  @Output() formSubmitted = new EventEmitter<Profile>();
  @ViewChild('form') form: NgForm | null = null;

  profile$!: Observable<ModelState>;
  model = initialModel;

  a: any;

  constructor(private store: Store<ApplicationState>) {

    this.a = this.store.select(getModelSlice).pipe(take(1)).subscribe((state) => {
      let model = getValue(state, "model") ?? initialModel;
      this.store.dispatch(new InitForm({ path: "model", value: model}));
      this.model = deepClone(model);
    });

    this.profile$ = this.store.select(getModelSlice);
  }

  updateProfile() {
    this.store.dispatch(new UpdateFormValue({value: {
      firstName: 'Nancy',
      address: {
        street: '123 Drew Street'
      }
    }, path: "model"}));
  }

  addAlias() {
    this.model.aliases.push('');
  }

  trackById(index: number, obj: string): any {
    return index;
  }

  onSubmit() {
    this.formSubmitted.emit(this.form!.value as Profile);
    alert("Form submitted successfully");
  }

  ngOnDestroy() {
    this.a.unsubscribe();
  }
}
