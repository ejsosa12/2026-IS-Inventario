import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CountCompare } from './count-compare';

describe('CountCompare', () => {
  let component: CountCompare;
  let fixture: ComponentFixture<CountCompare>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CountCompare],
    }).compileComponents();

    fixture = TestBed.createComponent(CountCompare);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
